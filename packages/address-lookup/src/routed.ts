/*
 * One AddressLookupPort over several, chosen by country.
 *
 * Address engines cover countries unevenly, and the cheapest good answer differs by country: the
 * platform's own index answers the United States for nothing, while a provider may be the only answer
 * somewhere else. Composing by country keeps that decision in one place, and keeps every caller on the
 * one port it already uses.
 *
 * A `suggest` knows its country; a `resolve` does not — it holds only an identifier some engine
 * minted. So every identifier leaving this port is prefixed with the name of the engine that minted
 * it, and `resolve` routes on that prefix. An identifier with no known prefix is an offer no engine
 * here knows, which is the port's `expired` answer, never an error.
 */
import {
  addressCountryNotCovered,
  resolutionExpired,
  type AddressLookupPort,
  type AddressSuggestion,
  type ResolveResult,
  type SuggestResult,
} from "./port.ts";

/** An engine with the name its identifiers are prefixed with. Names are lowercase letters only. */
export interface NamedAddressLookupPort {
  readonly name: string;
  readonly port: AddressLookupPort;
}

export interface RoutedAddressLookup {
  /** Which engine answers each country, keyed by ISO 3166-1 alpha-2 in capitals. */
  readonly byCountry: Readonly<Record<string, NamedAddressLookupPort>>;
  /** The engine for every other country; absent means they are not covered. */
  readonly otherwise?: NamedAddressLookupPort;
}

const SEPARATOR = ".";

function prefixed(engine: NamedAddressLookupPort, suggestion: AddressSuggestion): AddressSuggestion {
  return { ...suggestion, suggestionId: `${engine.name}${SEPARATOR}${suggestion.suggestionId}` };
}

/** The engine a country is routed to, or undefined when no engine covers it. */
export function engineForCountry(
  routes: RoutedAddressLookup,
  country: string,
): NamedAddressLookupPort | undefined {
  return routes.byCountry[country.toUpperCase()] ?? routes.otherwise;
}

/** The engine that minted an identifier this port handed out, and the identifier it minted. */
export function engineForSuggestion(
  routes: RoutedAddressLookup,
  suggestionId: string,
): { readonly engine: NamedAddressLookupPort; readonly suggestionId: string } | undefined {
  const separatorAt = suggestionId.indexOf(SEPARATOR);
  if (separatorAt <= 0) return undefined;
  const name = suggestionId.slice(0, separatorAt);
  const engines = [...Object.values(routes.byCountry), ...(routes.otherwise ? [routes.otherwise] : [])];
  const engine = engines.find((candidate) => candidate.name === name);
  return engine === undefined
    ? undefined
    : { engine, suggestionId: suggestionId.slice(separatorAt + 1) };
}

export function routedAddressLookupPort(routes: RoutedAddressLookup): AddressLookupPort {
  return {
    async suggest(input): Promise<SuggestResult> {
      const engine = engineForCountry(routes, input.country);
      if (engine === undefined) return addressCountryNotCovered(input.country.toUpperCase());
      const answer = await engine.port.suggest(input);
      if (!answer.ok) return answer;
      return { ok: true, suggestions: answer.suggestions.map((offer) => prefixed(engine, offer)) };
    },

    async resolve(input): Promise<ResolveResult> {
      const routed = engineForSuggestion(routes, input.suggestionId);
      if (routed === undefined) return resolutionExpired();
      const answer = await routed.engine.port.resolve({ suggestionId: routed.suggestionId });
      if (answer.ok && answer.resolution === "group") {
        return {
          ...answer,
          suggestions: answer.suggestions.map((offer) => prefixed(routed.engine, offer)),
        };
      }
      return answer;
    },
  };
}
