<script lang="ts">
  /* Reset Password — the destination of the sign-in screen's "Forgot password?" link. The request
     form and the set-a-new-password form both land here when the reset flow is built; the holding
     card keeps the link honest until then. */
  import AuthPlaceholder from "$lib/auth/auth-placeholder.svelte";
</script>

<AuthPlaceholder
  title="Reset Password"
  description="Set a new password for your firm account."
  note="This screen isn't built yet. Ask your firm's administrator to send you a reset link."
/>
