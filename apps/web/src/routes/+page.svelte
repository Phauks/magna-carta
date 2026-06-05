<script lang="ts">
  import { fetchHealth, type Health } from '$lib/health.ts'

  let state = $state<{ kind: 'loading' } | { kind: 'ok'; data: Health } | { kind: 'error'; msg: string }>({ kind: 'loading' })

  $effect(() => {
    fetchHealth()
      .then((data) => (state = { kind: 'ok', data }))
      .catch((e) => (state = { kind: 'error', msg: String(e) }))
  })
</script>

<main>
  <h1>Magna Carta</h1>
  {#if state.kind === 'loading'}
    <p>Checking API...</p>
  {:else if state.kind === 'ok'}
    <p>API: {state.data.status} · v{state.data.version} · {state.data.time}</p>
  {:else}
    <p>API error: {state.msg}</p>
  {/if}
</main>
