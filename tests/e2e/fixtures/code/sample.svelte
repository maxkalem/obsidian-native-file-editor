<script>
  // Svelte component: a counter with a derived label
  export let start = 0;
  let count = start;
  $: label = count === 1 ? "1 click" : `${count} clicks`;
  function bump() {
    count += 1;
  }
</script>

<style>
  button { padding: 0.5rem 1rem; color: var(--accent); }
</style>

<button on:click={bump}>{label}</button>
{#if count > 10}
  <p>That is a lot of clicks.</p>
{/if}
