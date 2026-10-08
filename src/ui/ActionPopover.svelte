<script lang="ts">
    import type { Snippet } from "svelte";
    interface Props { label: string; children: Snippet; compact?: boolean; }
    let { label, children, compact = false }: Props = $props();
    const id = $props.id();
    let root = $state<HTMLDivElement | null>(null);
    let trigger = $state<HTMLButtonElement | null>(null);
    let open = $state(false);
    let left = $state(8);
    let top = $state(8);

    function position(): void {
        if (!root || !trigger) return;
        const rect = trigger.getBoundingClientRect();
        const width = Math.min(280, window.innerWidth - 16);
        const height = root.getBoundingClientRect().height;
        left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
        top = rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4);
    }

    function close(restore = false): void {
        root?.hidePopover();
        if (restore) trigger?.focus({ preventScroll: true });
    }

    $effect(() => {
        const element = root;
        if (!element) return;
        const stopClick = (event: Event) => event.stopPropagation();
        const onKey = (event: KeyboardEvent) => {
            if (!open || event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return;
            event.preventDefault();
            event.stopPropagation();
            close(true);
        };
        const onFocusIn = (event: FocusEvent) => {
            const target = event.target;
            if (!open || !(target instanceof Node) || element.contains(target) || target === trigger) return;
            close();
        };
        element.addEventListener("click", stopClick);
        element.addEventListener("keydown", onKey);
        document.addEventListener("focusin", onFocusIn, true);
        return () => {
            element.removeEventListener("click", stopClick);
            element.removeEventListener("keydown", onKey);
            document.removeEventListener("focusin", onFocusIn, true);
        };
    });

    $effect(() => {
        if (!open || !root) return;
        const element = root;
        const onScroll = (event: Event) => { if (event.target instanceof Node && !element.contains(event.target)) close(); };
        const onBlur = () => close();
        document.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", position);
        window.addEventListener("blur", onBlur);
        return () => {
            document.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", position);
            window.removeEventListener("blur", onBlur);
        };
    });
</script>

<button type="button" class="glean-btn glean-btn--ghost glean-action-popover__trigger" class:glean-action-popover__trigger--compact={compact} bind:this={trigger} aria-label={label} aria-controls={id} aria-expanded={open} aria-haspopup="dialog" popovertarget={id} onclick={(event) => { event.stopPropagation(); position(); }}>
    {#if compact}<span class="glean-action-popover__trigger-icon" aria-hidden="true">⋯</span><span class="glean-action-popover__trigger-label">{label}</span>{:else}{label}{/if}
</button>
<div {id} class="glean-action-popover__body" bind:this={root} popover="auto" role="dialog" aria-label={label} aria-modal="false" tabindex="-1" style:left={`${left}px`} style:top={`${top}px`} ontoggle={(event) => { open = event.newState === "open"; if (open) position(); }}>
    {@render children()}
</div>
