"use client";

/**
 * WaterChemistryCalculator - Water Profile and Salt Additions Calculator
 *
 * Features:
 * - Select source and target water profiles
 * - Calculate required salt additions
 * - Display sulfate:chloride ratio with style guidance
 * - Estimate mash pH
 * - Save additions to recipe
 */

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  type WaterProfile,
  type SaltAdditions,
  type GrainBillItem,
  COMMON_PROFILES,
  STYLE_TARGETS,
  SALT_CONTRIBUTIONS,
  calculateAdditions,
  calculateResultingProfile,
  calculateSulfateChlorideRatio,
  getRatioDescription,
  calculateResidualAlkalinity,
  estimateMashPH,
} from "@/lib/water-chemistry";
import { Droplets, FlaskConical, Calculator, Check } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface WaterChemistryCalculatorProps {
  sourceProfile?: WaterProfile | null;
  volumeGal?: number;
  grainBill?: GrainBillItem[];
  onSave?: (additions: SaltAdditions, resultingProfile: WaterProfile) => void;
  disabled?: boolean;
}

// =============================================================================
// Helper Components
// =============================================================================

function ProfileDisplay({ profile, label }: { profile: WaterProfile; label: string }) {
  const ratio = calculateSulfateChlorideRatio(profile.sulfate_ppm, profile.chloride_ppm);
  const { label: ratioLabel, character } = getRatioDescription(ratio);

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <span className="text-muted-foreground">Ca:</span> {profile.calcium_ppm}
        </div>
        <div>
          <span className="text-muted-foreground">Mg:</span> {profile.magnesium_ppm}
        </div>
        <div>
          <span className="text-muted-foreground">Na:</span> {profile.sodium_ppm}
        </div>
        <div>
          <span className="text-muted-foreground">SO₄:</span> {profile.sulfate_ppm}
        </div>
        <div>
          <span className="text-muted-foreground">Cl:</span> {profile.chloride_ppm}
        </div>
        <div>
          <span className="text-muted-foreground">HCO₃:</span> {profile.bicarbonate_ppm}
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline" className="text-xs">
          SO₄:Cl = {ratio === Infinity ? "∞" : `${ratio}:1`}
        </Badge>
        <span className="text-muted-foreground">{ratioLabel}</span>
      </div>
    </div>
  );
}

function SaltAdditionRow({
  salt,
  grams,
  onChange,
  disabled,
}: {
  salt: keyof typeof SALT_CONTRIBUTIONS;
  grams: number;
  onChange: (grams: number) => void;
  disabled?: boolean;
}) {
  const info = SALT_CONTRIBUTIONS[salt];
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 text-sm">{info.name}</div>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          value={grams}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          disabled={disabled}
          className="h-8 w-20 text-right"
          step="0.1"
          min="0"
        />
        <span className="text-sm text-muted-foreground w-6">g</span>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function WaterChemistryCalculator({
  sourceProfile: initialSource,
  volumeGal: initialVolume = 10,
  grainBill = [],
  onSave,
  disabled = false,
}: WaterChemistryCalculatorProps) {
  // State
  const [sourceKey, setSourceKey] = useState<string>("distilled");
  const [targetKey, setTargetKey] = useState<string>("balanced");
  const [volume, setVolume] = useState(initialVolume);
  const [manualAdditions, setManualAdditions] = useState<SaltAdditions>({
    gypsum_g: 0,
    calcium_chloride_g: 0,
    epsom_salt_g: 0,
    baking_soda_g: 0,
    chalk_g: 0,
    table_salt_g: 0,
    magnesium_chloride_g: 0,
  });
  const [useCalculated, setUseCalculated] = useState(true);

  // Get profiles
  const sourceProfile: WaterProfile = initialSource || COMMON_PROFILES[sourceKey] || COMMON_PROFILES.distilled;
  const targetProfile = STYLE_TARGETS[targetKey] || STYLE_TARGETS.balanced;

  // Calculate suggested additions
  const calculatedAdditions = useMemo(
    () => calculateAdditions(sourceProfile, targetProfile, volume),
    [sourceProfile, targetProfile, volume]
  );

  // Use either calculated or manual additions
  const additions = useCalculated ? calculatedAdditions : manualAdditions;

  // Calculate resulting profile
  const resultingProfile = useMemo(
    () => calculateResultingProfile(sourceProfile, additions, volume),
    [sourceProfile, additions, volume]
  );

  // Calculate mash pH estimate
  const estimatedPH = useMemo(
    () => estimateMashPH(resultingProfile, grainBill, volume),
    [resultingProfile, grainBill, volume]
  );

  // Residual alkalinity
  const ra = calculateResidualAlkalinity(resultingProfile);

  // Update a single addition
  const updateAddition = (salt: keyof SaltAdditions, value: number) => {
    setUseCalculated(false);
    setManualAdditions((prev) => ({ ...prev, [salt]: value }));
  };

  // Reset to calculated
  const resetToCalculated = () => {
    setUseCalculated(true);
    setManualAdditions(calculatedAdditions);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Droplets className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-medium">Water Chemistry Calculator</h3>
      </div>

      {/* Source & Target Selection */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Source Water</CardTitle>
            <CardDescription>Your starting water profile</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!initialSource && (
              <Select value={sourceKey} onValueChange={setSourceKey} disabled={disabled}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(COMMON_PROFILES).map(([key, profile]) => (
                    <SelectItem key={key} value={key}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <ProfileDisplay profile={sourceProfile} label="Profile" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Target Profile</CardTitle>
            <CardDescription>Desired water character</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={targetKey} onValueChange={setTargetKey} disabled={disabled}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STYLE_TARGETS).map(([key, profile]) => (
                  <SelectItem key={key} value={key}>
                    {profile.name} ({profile.ratio})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ProfileDisplay profile={targetProfile} label="Target" />
          </CardContent>
        </Card>
      </div>

      {/* Volume Input */}
      <div className="flex items-center gap-4">
        <Label className="text-sm font-medium">Water Volume</Label>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value) || 1)}
            disabled={disabled}
            className="h-8 w-24"
            step="0.5"
            min="0.5"
          />
          <span className="text-sm text-muted-foreground">gal</span>
        </div>
      </div>

      <Separator />

      {/* Salt Additions */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <FlaskConical className="h-4 w-4" />
                Salt Additions
              </CardTitle>
              <CardDescription>
                {useCalculated ? "Calculated from target" : "Manual adjustments"}
              </CardDescription>
            </div>
            {!useCalculated && (
              <Button variant="outline" size="sm" onClick={resetToCalculated}>
                <Calculator className="h-4 w-4 mr-1" />
                Recalculate
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <SaltAdditionRow
            salt="gypsum"
            grams={additions.gypsum_g}
            onChange={(v) => updateAddition("gypsum_g", v)}
            disabled={disabled}
          />
          <SaltAdditionRow
            salt="calcium_chloride"
            grams={additions.calcium_chloride_g}
            onChange={(v) => updateAddition("calcium_chloride_g", v)}
            disabled={disabled}
          />
          <SaltAdditionRow
            salt="epsom_salt"
            grams={additions.epsom_salt_g}
            onChange={(v) => updateAddition("epsom_salt_g", v)}
            disabled={disabled}
          />
          <SaltAdditionRow
            salt="baking_soda"
            grams={additions.baking_soda_g}
            onChange={(v) => updateAddition("baking_soda_g", v)}
            disabled={disabled}
          />
          <SaltAdditionRow
            salt="chalk"
            grams={additions.chalk_g}
            onChange={(v) => updateAddition("chalk_g", v)}
            disabled={disabled}
          />
          <SaltAdditionRow
            salt="table_salt"
            grams={additions.table_salt_g}
            onChange={(v) => updateAddition("table_salt_g", v)}
            disabled={disabled}
          />
        </CardContent>
      </Card>

      {/* Resulting Profile */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Resulting Water Profile</CardTitle>
          <CardDescription>After salt additions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ProfileDisplay profile={resultingProfile} label="" />

          <Separator />

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Residual Alkalinity:</span>
              <div className="font-medium">{ra} ppm as CaCO₃</div>
            </div>
            {grainBill.length > 0 && (
              <div>
                <span className="text-muted-foreground">Est. Mash pH:</span>
                <div className="font-medium">{estimatedPH}</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      {onSave && (
        <Button
          onClick={() => onSave(additions, resultingProfile)}
          disabled={disabled}
          className="w-full"
        >
          <Check className="h-4 w-4 mr-2" />
          Save to Recipe
        </Button>
      )}
    </div>
  );
}
