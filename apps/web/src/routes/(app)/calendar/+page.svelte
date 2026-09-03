<script lang="ts">
  import CalendarScreen from "$lib/calendar/calendar-screen.svelte";

  let { data }: { data: { openEntry: string | null } } = $props();
</script>

<svelte:head><title>Calendar · Magna Carta</title></svelte:head>

<CalendarScreen title="Calendar" openEntry={data.openEntry} initialView="month" />
