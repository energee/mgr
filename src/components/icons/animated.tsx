"use client";

import type { ForwardRefExoticComponent, RefAttributes } from "react";
import { forwardRef, useImperativeHandle, useRef } from "react";

import { LayoutPanelTopIcon } from "@/components/ui/layout-panel-top";
import { FlaskIcon } from "@/components/icons/flask";
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
import { ArrowRightIcon } from "@/components/ui/arrow-right";
import { WavesIcon } from "@/components/ui/waves";
import { SquareStackIcon } from "@/components/ui/square-stack";
import { HardDriveUploadIcon } from "@/components/ui/hard-drive-upload";
import { HardDriveDownloadIcon } from "@/components/ui/hard-drive-download";
import { BellIcon } from "@/components/ui/bell";
import { UserIcon as AnimatedUserIconBase } from "@/components/ui/user";
import { LogOutIcon } from "@/components/ui/log-out";
import { EyeIcon } from "@/components/ui/eye";
import { SquarePenIcon } from "@/components/ui/square-pen";
import { DeleteIcon } from "@/components/ui/delete";
import { CopyIcon } from "@/components/ui/copy";
import { KeyboardIcon } from "@/components/ui/keyboard";
import { GaugeIcon } from "@/components/ui/gauge";
import { ChartLineIcon } from "@/components/ui/chart-line";
import { DropletIcon } from "@/components/ui/droplet";
import { LayersIcon } from "@/components/ui/layers";
import { FileStackIcon } from "@/components/ui/file-stack";
import { WaypointsIcon } from "@/components/ui/waypoints";
import { DrumIcon } from "@/components/ui/drum";
import { RouteIcon } from "@/components/ui/route";
import { ShipIcon } from "@/components/icons/ship";
import { FileCheckIcon } from "@/components/ui/file-check";
import { CheckCheckIcon } from "@/components/ui/check-check";
import { FolderOpenIcon } from "@/components/ui/folder-open";
import { ShieldCheckIcon } from "@/components/ui/shield-check";
import { ChartColumnIncreasingIcon } from "@/components/ui/chart-column-increasing";
import { HandCoinsIcon } from "@/components/ui/hand-coins";
import { CircleDollarSignIcon } from "@/components/ui/circle-dollar-sign";
import { TelescopeIcon } from "@/components/ui/telescope";
import { CogIcon } from "@/components/ui/cog";

export type AnimatedIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
}

export type AnimatedIconProps = {
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
export const AnimatedArrowRightLeft = wrap(ArrowRightIcon);
export const AnimatedContainer = wrap(SquareStackIcon);
export const AnimatedBatches = wrap(WavesIcon);
export const AnimatedUpload = wrap(HardDriveUploadIcon);
export const AnimatedDownload = wrap(HardDriveDownloadIcon);
export const AnimatedBell = wrap(BellIcon);
export const AnimatedUser = wrap(AnimatedUserIconBase);
export const AnimatedLogOut = wrap(LogOutIcon);
export const AnimatedEye = wrap(EyeIcon);
export const AnimatedSquarePen = wrap(SquarePenIcon);
export const AnimatedDelete = wrap(DeleteIcon);
export const AnimatedCopy = wrap(CopyIcon);
export const AnimatedKeyboard = wrap(KeyboardIcon);
export const AnimatedGauge = wrap(GaugeIcon);
export const AnimatedChartLine = wrap(ChartLineIcon);
export const AnimatedDroplet = wrap(DropletIcon);
export const AnimatedLayers = wrap(LayersIcon);
export const AnimatedFileStack = wrap(FileStackIcon);
export const AnimatedWaypoints = wrap(WaypointsIcon);
export const AnimatedDrum = wrap(DrumIcon);
export const AnimatedRoute = wrap(RouteIcon);
export const AnimatedShip = wrap(ShipIcon);
export const AnimatedFileCheck = wrap(FileCheckIcon);
export const AnimatedCheckCheck = wrap(CheckCheckIcon);
export const AnimatedFolderOpen = wrap(FolderOpenIcon);
export const AnimatedShieldCheck = wrap(ShieldCheckIcon);
export const AnimatedChartColumn = wrap(ChartColumnIncreasingIcon);
export const AnimatedHandCoins = wrap(HandCoinsIcon);
export const AnimatedCircleDollarSign = wrap(CircleDollarSignIcon);
export const AnimatedTelescope = wrap(TelescopeIcon);
export const AnimatedCog = wrap(CogIcon);
