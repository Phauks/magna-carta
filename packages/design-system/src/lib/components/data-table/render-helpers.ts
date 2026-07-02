/*
 * Cell/header render helpers. A table-core `columnDef.cell`/`columnDef.header` may be a string, a
 * value, or a function returning content; to let a column render a Svelte component or snippet we tag
 * those with a marker class the FlexRender component recognises. `renderComponent`/`renderSnippet` are
 * the public way to do this from a column definition; FlexRender unwraps them.
 */
import type { Component, ComponentProps, Snippet } from "svelte";

/** Marks a column's content as a Svelte component to mount (see FlexRender). */
export class RenderComponentConfig<TComponent extends Component> {
  component: TComponent;
  props: ComponentProps<TComponent> | Record<string, never>;
  constructor(
    component: TComponent,
    props: ComponentProps<TComponent> | Record<string, never> = {},
  ) {
    this.component = component;
    this.props = props;
  }
}

/** Marks a column's content as a Svelte snippet to render (see FlexRender). */
export class RenderSnippetConfig<TProps> {
  snippet: Snippet<[TProps]>;
  params: TProps;
  constructor(snippet: Snippet<[TProps]>, params: TProps) {
    this.snippet = snippet;
    this.params = params;
  }
}

/** Render a Svelte component as a column's header/cell — pair with `<FlexRender>`. */
export function renderComponent<TComponent extends Component<Record<string, unknown>>>(
  component: TComponent,
  props: ComponentProps<TComponent> = {} as ComponentProps<TComponent>,
) {
  return new RenderComponentConfig(component, props);
}

/** Render a single-parameter Svelte snippet as a column's header/cell — pair with `<FlexRender>`. */
export function renderSnippet<TProps>(snippet: Snippet<[TProps]>, params: TProps = {} as TProps) {
  return new RenderSnippetConfig(snippet, params);
}
