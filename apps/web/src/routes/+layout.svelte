<script lang="ts">
  import '../app.css'
  // The one Toaster host: toast() calls from anywhere in the app enqueue into it.
  import { Toaster } from '@magna-carta/design-system/toast'

  let { children } = $props()
</script>

{@render children()}
<Toaster />
