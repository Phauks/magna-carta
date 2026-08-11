<script lang="ts">
  /* Recovery Code — the destination of the code step's "Use a recovery code" link, for a visitor
     whose authenticator is unavailable. The entry form lands here when the recovery flow is built;
     the holding card keeps the link honest until then. */
  import AuthPlaceholder from "$lib/auth/auth-placeholder.svelte";
</script>

<AuthPlaceholder
  title="Recovery Code"
  description="Enter one of your saved recovery codes. Each code works once."
  note="This screen isn't built yet. Use your authenticator app, or ask your firm's administrator for help."
/>
