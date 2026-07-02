<script
  lang="ts"
  generics="TData, TValue, TContext extends HeaderContext<TData, TValue> | CellContext<TData, TValue>"
>
  /*
   * FlexRender — renders a table-core header/cell `content` whatever its form: a plain string/value,
   * a function returning a value, or a function returning a renderComponent()/renderSnippet() marker
   * (which it mounts). Pass `cell.column.columnDef.cell` / `header.column.columnDef.header` as
   * `content` and the matching `getContext()` as `context`. The default table-core cell stringifies
   * the value, so plain accessor columns render their text with no custom `cell`.
   */
  import type { CellContext, ColumnDefTemplate, HeaderContext } from "@tanstack/table-core";
  import { RenderComponentConfig, RenderSnippetConfig } from "./render-helpers.ts";

  type Props = {
    /** The `cell` or `header` field of the column definition for this cell/header. */
    content?: TContext extends HeaderContext<TData, TValue>
      ? ColumnDefTemplate<HeaderContext<TData, TValue>>
      : TContext extends CellContext<TData, TValue>
        ? ColumnDefTemplate<CellContext<TData, TValue>>
        : never;
    /** The result of the header's/cell's `getContext()`. */
    context: TContext;
  };

  let { content, context }: Props = $props();
</script>

{#if typeof content === "string"}
  {content}
{:else if content instanceof Function}
  {@const result = content(context as never)}
  {#if result instanceof RenderComponentConfig}
    {@const { component: Component, props } = result}
    <Component {...props} />
  {:else if result instanceof RenderSnippetConfig}
    {@const { snippet, params } = result}
    {@render snippet(params)}
  {:else}
    {result}
  {/if}
{/if}
