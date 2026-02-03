"use client";

import type { ForwardRefExoticComponent, RefAttributes } from "react";
import { forwardRef, useImperativeHandle, useRef } from "react";

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
import { BoxIcon } from "@/components/ui/box";
import { CircleCheckIcon } from "@/components/ui/circle-check";
import { HomeIcon } from "@/components/ui/home";
import { CalendarDaysIcon } from "@/components/ui/calendar-days";
import { ArrowRightIcon } from "@/components/ui/arrow-right";
import { WavesIcon } from "@/components/ui/waves";
import { SquareStackIcon } from "@/components/ui/square-stack";
import { HardDriveUploadIcon } from "@/components/ui/hard-drive-upload";
import { HardDriveDownloadIcon } from "@/components/ui/hard-drive-download";
import { BellIcon } from "@/components/ui/bell";
import { UserIcon as AnimatedUserIconBase } from "@/components/ui/user";
import { LogOutIcon } from "@/components/ui/log-out";

export interface AnimatedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

export interface AnimatedIconProps {
  className?: string;
  ref?: React.Ref<AnimatedIconHandle>;
}

/**
 * Wraps an animated icon to forward a ref with startAnimation/stopAnimation.
 * The parent row can use the ref to trigger animation on hover.
 */
function wrap(
  AnimatedIcon: ForwardRefExoticComponent<
    { size?: number; className?: string } & RefAttributes<AnimatedIconHandle>
  >
) {
  const WrappedIcon = forwardRef<AnimatedIconHandle, { className?: string }>(
    ({ className }, outerRef) => {
      const innerRef = useRef<AnimatedIconHandle>(null);

      useImperativeHandle(outerRef, () => ({
        startAnimation: () => innerRef.current?.startAnimation(),
        stopAnimation: () => innerRef.current?.stopAnimation(),
      }));

      return <AnimatedIcon ref={innerRef} size={16} className={className} />;
    }
  );
  WrappedIcon.displayName = `Animated(${AnimatedIcon.displayName ?? "Icon"})`;
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
export const AnimatedPackage = wrap(BoxIcon);
export const AnimatedPackageCheck = wrap(CircleCheckIcon);
export const AnimatedWarehouse = wrap(AnimatedBoxesIconBase);
export const AnimatedBuilding2 = wrap(HomeIcon);
export const AnimatedCalendarClock = wrap(CalendarDaysIcon);
export const AnimatedArrowRightLeft = wrap(ArrowRightIcon);
export const AnimatedContainer = wrap(SquareStackIcon);
export const AnimatedBatches = wrap(WavesIcon);
export const AnimatedUpload = wrap(HardDriveUploadIcon);
export const AnimatedDownload = wrap(HardDriveDownloadIcon);
export const AnimatedBell = wrap(BellIcon);
export const AnimatedUser = wrap(AnimatedUserIconBase);
export const AnimatedLogOut = wrap(LogOutIcon);
