<script lang="ts">
  /*
   * A page whose render throws — the sign-in screen the day the version chip's tooltip found no
   * provider above it. The message mimics that throw so the test reads like the incident.
   */
  function broken(): string {
    throw new Error('Context "Tooltip.Provider" not found');
  }
</script>

<p>{broken()}</p>
