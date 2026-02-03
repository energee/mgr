"use client";

import type { ComponentType } from "react";

import { LayoutPanelTopIcon } from "@/components/ui/layout-panel-top";
import { FlaskIcon } from "@/components/ui/flask";
import { DollarSignIcon } from "@/components/ui/dollar-sign";
import { SettingsIcon } from "@/components/ui/settings";
import { CircleHelpIcon } from "@/components/ui/circle-help";
import { FileTextIcon } from "@/components/ui/file-text";
import { BoxesIcon as AnimatedBoxesIconBase } from "@/components/ui/boxes";
import { UsersIcon } from "@/components/ui/users";
import { ChevronDownIcon } from "@/components/ui/chevron-down";
import { ClipboardCheckIcon } from "@/components/ui/clipboard-check";
import { ChartBarIncreasingIcon } from "@/components/ui/chart-bar-increasing";
import { TruckIcon } from "@/components/ui/truck";
import { CartIcon } from "@/components/ui/cart";
import { TrendingUpIcon } from "@/components/ui/trending-up";

/**
 * Wraps an animated icon component to match lucide-react's
 * `{ className?: string }` interface expected by the sidebar.
 */
function wrap(
  AnimatedIcon: ComponentType<{ size?: number; className?: string }>
) {
  const WrappedIcon = ({ className }: { className?: string }) => (
    <AnimatedIcon size={16} className={className} />
  );
  WrappedIcon.displayName = `Animated(${(AnimatedIcon as { displayName?: string }).displayName ?? "Icon"})`;
  return WrappedIcon;
}

export const AnimatedLayoutDashboard = wrap(LayoutPanelTopIcon);
export const AnimatedFlask = wrap(FlaskIcon);
export const AnimatedDollarSign = wrap(DollarSignIcon);
export const AnimatedSettings = wrap(SettingsIcon);
export const AnimatedHelpCircle = wrap(CircleHelpIcon);
export const AnimatedFileText = wrap(FileTextIcon);
export const AnimatedBoxes = wrap(AnimatedBoxesIconBase);
export const AnimatedUsers = wrap(UsersIcon);
export const AnimatedChevronDown = wrap(ChevronDownIcon);
export const AnimatedClipboardList = wrap(ClipboardCheckIcon);
export const AnimatedBarChart3 = wrap(ChartBarIncreasingIcon);
export const AnimatedTruck = wrap(TruckIcon);
export const AnimatedShoppingCart = wrap(CartIcon);
export const AnimatedTrendingUp = wrap(TrendingUpIcon);
