<script lang="ts">
  /*
   * Search: one question, asked of every matter the reader may see.
   *
   * It is reached from the top bar. The palette there finds the application's own screens as it
   * always has; its last row sends whatever was typed here, where the firm's records are searched.
   * A matter's own search stays where it is, inside the matter, and reaches more of that one
   * matter than this page does: the words inside its files, its parties, its calendar. The list
   * under "Not Searched" says which places those are, read from the server's own answer.
   *
   * THE QUESTION, THE PLACE AND THE MATTERS RIDE IN THE ADDRESS. `?q=`, `?in=` and the reader's
   * choice of matters (`?scope=mine`, `?client=`) are the state, so a search survives a reload,
   * the back button walks a reader's searches, and a place beside the results is an ordinary
   * link. The trade taken with it: the words searched for land in browser history.
   *
   * THE READER MAY ASK FEWER MATTERS, NEVER MORE. The row under the field narrows the search to
   * their own matters or to one client's. One matter is that matter's own search, which reaches
   * more of it, so choosing a matter goes there with the question.
   *
   * A QUESTION IS READ BEFORE IT IS SEARCHED. "hargrove invoices since june" is words, a place
   * and some days; question-reading.ts takes the place and the days out by rule and the rest is
   * searched. Every reading is a chip under the field the reader can take away, and the question
   * as typed rides in `?asked=` so the field shows it and "Search the Words Only" can search it
   * as typed.
   *
   * WHAT IT REACHES IS DECIDED BY THE SERVER, per reader. A record is here only where the reader
   * may see its matter and holds the permission its own section asks for, and a matter the reader
   * cannot see contributes nothing to any result or any count.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Badge from "@magna-carta/design-system/badge";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { todayCivil } from "$lib/calendar/calendar-window.ts";
  import { presentationFor } from "$lib/matters/matter-search-presentation.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import {
    readAnything,
    readQuestion,
    understoodChips,
    type UnderstoodChip,
  } from "$lib/search/question-reading.ts";
  import SearchAcrossMattersResults from "$lib/search/search-across-matters-results.svelte";
  import {
    SearchAcrossMatters,
    railPlaces,
    unsearchedPlaces,
  } from "$lib/search/search-across-matters.svelte.ts";
  import {
    ALL_PLACES,
    EVERYTHING,
    MATTERS_PLACE,
    MY_MATTERS,
    PEOPLE_PLACE,
    daysFromAddress,
    daysKey,
    placeFromAddress,
    reachFromAddress,
    reachKey,
    searchAddress,
    type SearchReach,
  } from "$lib/search/search-address.ts";
  import SearchReachControl from "$lib/search/search-reach-control.svelte";
  import UnderstoodChips from "$lib/search/understood-chips.svelte";
  import { reachFieldLabel, reachSentence } from "$lib/search/search-reach.ts";

  const search = new SearchAcrossMatters();

  // The address is the state. Reading the question, the place and the matters FROM it, and
  // holding no second copy, is what makes a reload, a shared link and the back button all land on
  // the same search.
  const addressQuery = $derived(page.url.searchParams.get("q") ?? "");
  const addressPlace = $derived(placeFromAddress(page.url.searchParams.get("in")));
  // Held by its key, so a new address object naming the same matters does not ask again.
  const addressReachKey = $derived(
    reachKey(
      reachFromAddress(page.url.searchParams.get("scope"), page.url.searchParams.get("client")),
    ),
  );
  const addressReach = $derived.by((): SearchReach => {
    void addressReachKey;
    return reachFromAddress(
      page.url.searchParams.get("scope"),
      page.url.searchParams.get("client"),
    );
  });

  // The question as typed, where a reading took something out of it.
  const addressAsked = $derived(page.url.searchParams.get("asked"));
  // Held by its key, like the reach, so a new address naming the same days does not ask again.
  const addressDaysKey = $derived(
    daysKey(daysFromAddress(page.url.searchParams.get("from"), page.url.searchParams.get("to"))),
  );
  const addressDays = $derived.by(() => {
    void addressDaysKey;
    return daysFromAddress(page.url.searchParams.get("from"), page.url.searchParams.get("to"));
  });
  // What the field shows: the question as the reader typed it.
  const shownQuestion = $derived(addressAsked ?? addressQuery);

  let field = $state("");
  $effect(() => {
    field = shownQuestion;
  });

  $effect(() => {
    void search.run(fetch, addressQuery, addressPlace, addressReach, addressDays);
  });

  function retrySearch(): void {
    void search.run(fetch, addressQuery, addressPlace, addressReach, addressDays);
  }

  function placeName(place: string): string {
    if (place === MATTERS_PLACE) return "Matters";
    if (place === PEOPLE_PLACE) return "People";
    return presentationFor(place).heading;
  }

  const chips = $derived(
    understoodChips({
      asked: addressAsked,
      place: addressPlace,
      mine: addressReach.kind === "mine",
      days: addressDays,
      today: todayCivil(),
      placeName,
      formatDay: (day) => formatDate(day),
    }),
  );

  // Taking a reading away searches without it, and keeps the rest of what was read.
  function removeReading(key: UnderstoodChip["key"]): void {
    const place = key === "place" ? ALL_PLACES : addressPlace;
    const reach = key === "mine" ? EVERYTHING : addressReach;
    const days = key === "days" ? null : addressDays;
    void goto(searchAddress(addressQuery, place, reach, { days, asked: addressAsked }), {
      keepFocus: true,
    });
  }

  // The question as typed, searched as words with nothing read out of it. A choice of matters the
  // reader made by hand stays; the one the question named goes with the other readings.
  function searchWordsOnly(): void {
    if (addressAsked === null) return;
    const reach = chips.some((chip) => chip.key === "mine") ? EVERYTHING : addressReach;
    void goto(searchAddress(addressAsked, ALL_PLACES, reach), { keepFocus: true });
  }

  // Typing rewrites the address, which re-runs the search through the effect above. One path, so
  // the field and the address can never say different things. A new question starts over at every
  // place: the place a reader had chosen was chosen for the last question's results. The matters
  // chosen stay, because they were chosen for the reader and not for a question.
  //
  // The question is read first. What it named (a place, the reader's own matters, some days) goes
  // into the address beside the words, and the question as typed goes with them.
  function submit(next: string): void {
    if (next.trim() === shownQuestion.trim()) return;
    const reading = readQuestion(next, todayCivil());
    const address = readAnything(reading)
      ? searchAddress(
          reading.words,
          reading.place ?? ALL_PLACES,
          reading.mine ? MY_MATTERS : addressReach,
          { days: reading.days, asked: next },
        )
      : searchAddress(next, ALL_PLACES, addressReach);
    void goto(address, { replaceState: true, keepFocus: true });
  }

  // A different choice of matters is a different search of the same question, and starts over at
  // every place for the reason a new question does. It is a step the back button returns from.
  function chooseReach(next: SearchReach): void {
    if (reachKey(next) === addressReachKey) return;
    void goto(
      searchAddress(addressQuery, ALL_PLACES, next, { days: addressDays, asked: addressAsked }),
      { keepFocus: true },
    );
  }

  // One matter is searched by that matter's own search, which carries the question in its address
  // the same way.
  function searchOneMatter(matterId: string): void {
    const question = addressQuery.trim();
    const suffix = question === "" ? "" : `?${new URLSearchParams({ q: question }).toString()}`;
    void goto(`/matters/${matterId}/search${suffix}`);
  }

  const places = $derived(railPlaces(search.overview));
  const unsearched = $derived(unsearchedPlaces(search.overview));
  const asked = $derived(addressQuery.trim() !== "");
  // A question read down to no words: a place or some days with nothing to look for in them.
  const nothingLeft = $derived(!asked && (addressAsked ?? "").trim() !== "");
</script>

<svelte:head>
  <title>Search · Magna Carta</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader title="Search" />

  <div class="flex flex-col gap-8 border-b border-border-default pb-12">
    <ScreenSearch
      bind:value={field}
      expanded
      busy={search.busy}
      label={reachFieldLabel(addressReach)}
      searchOn="pause"
      fieldClass="w-xs sm:w-md"
      onsearch={submit}
    />
    <SearchReachControl reach={addressReach} onReach={chooseReach} onMatter={searchOneMatter} />
    <UnderstoodChips
      {chips}
      onRemove={removeReading}
      {...addressAsked === null ? {} : { onWordsOnly: searchWordsOnly }}
    />
    <p class="text-xs text-text-muted">{reachSentence(addressReach)}</p>
  </div>

  <div class="mc-scrollbar min-h-0 flex-1 overflow-y-auto">
    {#if nothingLeft}
      <p class="text-sm text-text-muted">
        Add a word to look for, such as a name. A place and a date narrow a search; they are not a search on their own.
      </p>
    {:else if !asked}
      <p class="text-sm text-text-muted">
        Type a name, a number or a few words. To search inside a matter's files, open the matter and use its search.
      </p>
    {:else}
      <div class="flex flex-col gap-24 lg:flex-row lg:items-start">
        <nav aria-label="Places searched" class="flex w-full shrink-0 flex-col gap-16 lg:w-2xs">
          {#if places.length > 0}
            <ul class="flex flex-col gap-2">
              {#each places as place (place.key)}
                {@const current = place.key === addressPlace}
                <li>
                  <a
                    href={searchAddress(addressQuery, place.key, addressReach, {
                      days: addressDays,
                      asked: addressAsked,
                    })}
                    aria-current={current ? "page" : undefined}
                    class={[
                      "flex items-center justify-between gap-8 rounded-sm px-12 py-8 text-sm",
                      "transition-colors duration-fast ease-standard hover:bg-surface-subtle",
                      current
                        ? "bg-surface-selected font-semibold text-text-default"
                        : "text-text-default",
                    ]}
                  >
                    <span>{place.label}</span>
                    <span class="text-xs text-text-muted">
                      {#if place.shown === null}
                        <span class="sr-only">Could not be searched</span>
                      {:else}
                        {place.shown}{place.more ? "+" : ""}
                      {/if}
                    </span>
                  </a>
                </li>
              {/each}
            </ul>
          {/if}

          {#if search.overview !== null}
            <div class="flex flex-col gap-8">
              <h2 class="px-12 text-xs font-semibold text-text-muted">Not Searched</h2>
              <ul class="flex flex-col gap-2">
                {#each unsearched as place (place.key)}
                  <li
                    class="flex items-center justify-between gap-8 px-12 py-4 text-sm text-text-muted"
                    title={place.reason}
                  >
                    <span>{place.label}</span>
                    <Badge variant="neutral">{place.mark}</Badge>
                  </li>
                {/each}
              </ul>
              {#each unsearched.filter((place) => place.writtenOut === true) as place (place.key)}
                <p class="px-12 text-xs text-text-muted">{place.reason}</p>
              {/each}
              <p class="px-12 text-xs text-text-muted">
                Places marked In A Matter are searched from that matter. Review sets are searched only from inside the set, by people with access.
              </p>
            </div>
          {/if}
        </nav>

        <div class="min-w-0 flex-1 pb-24">
          <SearchAcrossMattersResults
            overview={search.overview}
            placeGroup={search.place}
            chosen={addressPlace}
            failure={search.failure}
            busy={search.busy}
            asked={addressAsked}
            onRetry={retrySearch}
          />
        </div>
      </div>
    {/if}
  </div>
</div>
