import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "bg-muted text-muted-foreground pointer-events-none inline-flex h-4 w-fit min-w-4 items-center justify-center gap-0.5 rounded-sm px-1 font-sans text-[10px] font-medium select-none",
        "[&_svg:not([class*='size-'])]:size-2.5",
        "[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10",
        "[[data-slot=button]_&]:bg-primary-foreground/20 [[data-slot=button]_&]:text-primary-foreground",
        "[[data-slot=button]:is([data-variant=ghost],[data-variant=outline])_&]:bg-foreground/10 [[data-slot=button]:is([data-variant=ghost],[data-variant=outline])_&]:text-foreground/50",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
