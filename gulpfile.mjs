import assert from "node:assert/strict";
import child_process from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import stream from "node:stream";

import cordovaPkg from "cordova-lib";
import { glob } from "glob";
import gulp from "gulp";
import jeditor from "gulp-json-editor";
import rename from "gulp-rename";
import replace from "gulp-replace";
import minimist from "minimist";
import source from "vinyl-source-stream";
import * as vite from "vite";

import pkg from "./package.json" with { type: "json" };

const { cordova } = cordovaPkg;

const argv = minimist(process.argv.slice(2));

const BUNDLE_DIR = "./bundle";
const APP_DIR = "./app";
const REDIST_DIR = "./redist";

const context = {};
parseArgs();

export const app = build_app();
export const bundle = build_bundle();
export const redist = build_redist();

function clean_app() {
  return runAsync(fs.rm(APP_DIR, { recursive: true, force: true }));
}

function clean_bundle() {
  return runAsync(fs.rm(BUNDLE_DIR, { recursive: true, force: true }));
}

function clean_redist() {
  return runAsync(fs.rm(REDIST_DIR, { recursive: true, force: true }));
}

function build_bundle() {
  return gulp.series(clean_bundle, bundle_vite, bundle_src, bundle_deps);
}

function bundle_vite() {
  return runAsync(
    vite.build({ define: { __BACKEND__: JSON.stringify("cordova") } }),
  );
}

function bundle_src() {
  const distSources = [
    "./src/tabs/**/*.html",
    "!./src/tabs/map.html",
    "!./src/tabs/receiver_msp.html",
  ];
  const packageJson = new stream.Readable();
  packageJson.push(JSON.stringify(pkg, undefined, 2));
  packageJson.push(null);

  return packageJson
    .pipe(source("package.json"))
    .pipe(gulp.src(distSources, { base: "." }))
    .pipe(gulp.src(["pnpm-lock.yaml", "pnpm-workspace.yaml"]))
    .pipe(gulp.dest(BUNDLE_DIR));
}

function bundle_deps() {
  return runAsync(
    new Promise((resolve, reject) =>
      child_process.exec(
        "pnpm install --prod --frozen-lockfile --node-linker=hoisted",
        { cwd: BUNDLE_DIR },
        (err) => (err ? reject(err) : resolve()),
      ),
    ),
  );
}

function helper_build_app_cordova() {
  context.appdir = `${APP_DIR}/${context.target.platform}`;

  return gulp.series(
    build_bundle(),
    cordova_copy_www,
    cordova_resources,
    cordova_include_www,
    cordova_copy_src,
    cordova_rename_src_config,
    cordova_rename_src_package,
    cordova_packagejson,
    cordova_configxml,
    cordova_deps,
    cordova_build,
  );
}

function build_app() {
  return gulp.series(clean_app, helper_build_app_cordova());
}

function build_redist() {
  return gulp.series(
    clean_redist,
    build_app(),
    mkdir_redist,
    helper_build_redist(),
  );
}

function mkdir_redist() {
  return runAsync(fs.mkdir(REDIST_DIR, { recursive: true }));
}

function helper_build_redist() {
  return build_redist_apk;
}

function run_debug_cordova() {
  return runAsync(cordova.run());
}

function cordova_copy_www() {
  return gulp
    .src(`${BUNDLE_DIR}/**`, { base: BUNDLE_DIR, follow: true })
    .pipe(gulp.dest(`${context.appdir}/www/`));
}

function cordova_resources() {
  return gulp
    .src("assets/android/**")
    .pipe(gulp.dest(`${context.appdir}/resources/android/`));
}

function cordova_include_www() {
  return gulp
    .src(`${context.appdir}/www/index.html`)
    .pipe(
      replace(
        "<!-- CORDOVA_INCLUDE cordova.js -->",
        '<script type="text/javascript" src="/cordova.js"></script>',
      ),
    )
    .pipe(gulp.dest(`${context.appdir}/www/`));
}

function cordova_copy_src() {
  return gulp
    .src([
      `cordova/**`,
      `!cordova/config_template.xml`,
      `!cordova/package_template.json`,
    ])
    .pipe(gulp.dest(context.appdir));
}

function cordova_rename_src_config() {
  return gulp
    .src("cordova/config_template.xml")
    .pipe(rename("config.xml"))
    .pipe(gulp.dest(context.appdir));
}

function cordova_rename_src_package() {
  return gulp
    .src("cordova/package_template.json")
    .pipe(rename("package.json"))
    .pipe(gulp.dest(context.appdir));
}

function cordova_packagejson() {
  return gulp
    .src(`${context.appdir}/package.json`)
    .pipe(
      jeditor({
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
        author: pkg.author,
        license: pkg.license,
      }),
    )
    .pipe(gulp.dest(context.appdir));
}

function cordova_configxml() {
  return gulp
    .src([`${context.appdir}/config.xml`])
    .pipe(replace("{{name}}", pkg.productName))
    .pipe(replace("{{description}}", pkg.description))
    .pipe(replace("{{author}}", pkg.author))
    .pipe(replace("{{version}}", pkg.version))
    .pipe(gulp.dest(context.appdir));
}

function cordova_deps() {
  return runAsync(
    new Promise((resolve, reject) =>
      child_process.exec(
        "pnpm install --prod --no-frozen-lockfile --node-linker=hoisted",
        { cwd: context.appdir },
        (err) => (err ? reject(err) : resolve()),
      ),
    ),
  );
}

function cordova_build() {
  return runAsync(async () => {
    const cwd = process.cwd();
    process.chdir(context.appdir);
    try {
      await cordova.platform("add", ["android"]);
      await cordova.build({
        platforms: ["android"],
        options: {
          release: context.target.flavor !== "debug",
          buildConfig: "build.json",
          argv: ["--versionCode", "13"],
        },
      });
    } finally {
      process.chdir(cwd);
    }
  });
}

function build_redist_apk() {
  const { flavor } = context.target;
  const filename = "rf-cordova.apk";
  return gulp
    .src(
      `${context.appdir}/platforms/android/app/build/outputs/apk/${flavor}/app-${flavor}.apk`,
    )
    .pipe(rename(filename))
    .pipe(gulp.dest(REDIST_DIR));
}

function parseArgs() {
  const platforms = ["linux", "osx", "win", "android"];
  const arches = ["x86", "x86_64", "arm64"];

  const target = {
    platform: argv.platform ?? getHostPlatform(),
    arch: argv.arch ?? getHostArch(),
    flavor: argv.debug ? "debug" : "release",
  };

  if (target.platform) {
    assert(
      platforms.includes(target.platform),
      `unsupported platform: ${target.platform}`,
    );

    if (target.platform === "android") {
      target.arch = null;
    } else {
      assert(arches.includes(target.arch), `unsupported arch: ${target.arch}`);
    }
  }

  context.target = target;
}

function getHostPlatform() {
  return {
    linux: "linux",
    darwin: "osx",
    win32: "win",
  }[process.platform];
}

function getHostArch() {
  return {
    x64: "x86_64",
    arm64: "arm64",
    ia32: "x86",
  }[process.arch];
}

async function nop() {}

async function runAsync(fn) {
  try {
    await (typeof fn === "function" ? fn() : fn);
  } catch (err) {
    console.log(err);
    throw err;
  }
}
