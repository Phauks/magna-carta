<script lang="ts">
  import CalendarScreen from "$lib/calendar/calendar-screen.svelte";

  let { data }: { data: { openEntry: string | null } } = $props();
</script>

<svelte:head><title>Firm Events · Magna Carta</title></svelte:head>

<CalendarScreen title="Firm Events" back="calendar" openEntry={data.openEntry} initialView="agenda" />
