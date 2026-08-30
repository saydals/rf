<script>
  let {
    value = $bindable(0),
    min: minRaw = 0,
    max: maxRaw = 100,
    step: stepRaw = 1,
    disabled,
    onchange,
    id,
  } = $props();

  let hasStep = $derived(stepRaw !== undefined && stepRaw !== null);
  let step = $derived(hasStep ? String(stepRaw) : undefined);
</script>

<input
  {id}
  type="number"
  min={minRaw}
  max={maxRaw}
  step={hasStep ? step : undefined}
  {disabled}
  bind:value
  {onchange}
/>

<style lang="scss">
  input {
    padding: 0 8px;
    width: 100%;
    transition:
      background-color var(--animation-speed),
      color var(--animation-speed);

    text-align: right;
    line-height: 1.5rem;
    height: 1.5rem;
    font-size: 0.8rem;
    outline: none;
    border-radius: 2px;
    border: 1px solid var(--color-border-soft);
    background-color: var(--color-input-bg);
    color: var(--color-text);

    &:disabled {
      pointer-events: none;
    }
  }

  @media only screen and (max-width: 480px) {
    input {
      height: 2rem;
      line-height: 2rem;
      text-align: center;
      font-size: 0.8rem !important;
    }
  }
</style>
