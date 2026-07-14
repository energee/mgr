"use client";

/** Admin workflow for previewing, mapping, applying, and auditing Beer Orders uploads. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUpload, FileUploadDropzone } from "@/components/ui/file-upload";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { beerOrderImportKeys } from "@/lib/query-keys";
import type {
  BeerOrderImportPlan,
  BeerOrderImportRun,
  BeerOrderMappingOverrides,
  UnresolvedBeerOrderBrand,
} from "@/integrations/beer-orders/types";

const MAX_FILE_SIZE = 4 * 1024 * 1024;

type PreviewResponse = {
  runId: string;
  filename: string;
  sha256: string;
  plan: BeerOrderImportPlan;
};

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body.data as T;
}

function SummaryGrid({ plan }: { plan: BeerOrderImportPlan }) {
  const values = [
    ["Source orders", plan.summary.sourceOrders],
    ["Create", plan.summary.createdOrders],
    ["Update", plan.summary.updatedOrders],
    ["Unchanged", plan.summary.unchangedOrders],
    ["Planned lines", plan.summary.plannedLines],
    ["In House skipped", plan.summary.skippedInternalBlocks],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {values.map(([label, value]) => (
        <div key={label} className="rounded-md border p-3">
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      ))}
    </div>
  );
}

function BrandMappingFields({
  item,
  plan,
  value,
  onChange,
}: {
  item: UnresolvedBeerOrderBrand;
  plan: BeerOrderImportPlan;
  value: { brandId?: string; tier?: number };
  onChange: (value: { brandId: string; tier?: number }) => void;
}) {
  const brandId = value.brandId ?? item.brandId ?? "_none";
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
      <Select
        value={brandId}
        onValueChange={(next) => onChange({ brandId: next, tier: value.tier })}
        disabled={!item.requiresBrand}
      >
        <SelectTrigger aria-label={`Brand mapping for ${item.sourceLabel}`}>
          <SelectValue placeholder="Select brand" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_none" disabled>Select brand</SelectItem>
          {plan.options.brands.map((brand) => (
            <SelectItem key={brand.id} value={brand.id}>
              {brand.name}{brand.variant ? ` — ${brand.variant}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={value.tier ? String(value.tier) : "_none"}
        onValueChange={(next) => onChange({
          brandId: brandId === "_none" ? "" : brandId,
          tier: Number(next),
        })}
        disabled={!item.requiresTier}
      >
        <SelectTrigger aria-label={`Distributor tier for ${item.sourceLabel}`}>
          <SelectValue placeholder="Tier" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_none" disabled>Tier</SelectItem>
          {[1, 2, 3, 4, 5, 6, 7].map((tier) => (
            <SelectItem key={tier} value={String(tier)}>Tier {tier}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function MappingPanel({
  preview,
  overrides,
  setOverrides,
  onRepreview,
  pending,
}: {
  preview: PreviewResponse;
  overrides: BeerOrderMappingOverrides;
  setOverrides: (value: BeerOrderMappingOverrides) => void;
  onRepreview: () => void;
  pending: boolean;
}) {
  const { plan } = preview;
  const mappingsComplete = plan.unresolved.customers.every(
    (item) => Boolean(overrides.customers?.[item.sourceKey]?.customerId || overrides.customers?.[item.sourceKey]?.createName),
  ) && plan.unresolved.brands.every((item) => {
    const selection = overrides.brands?.[item.sourceKey];
    const hasBrand = Boolean(selection?.brandId || item.brandId);
    return hasBrand && (!item.requiresTier || Boolean(selection?.tier));
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resolve mappings</CardTitle>
        <CardDescription>
          These selections are saved when the reconciliation is applied.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {plan.unresolved.customers.map((item) => (
          <div key={item.sourceKey} className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center">
            <div className="text-sm font-medium">{item.sourceLabel}</div>
            <Select
              value={
                overrides.customers?.[item.sourceKey]?.createName
                  ? "_create"
                  : overrides.customers?.[item.sourceKey]?.customerId ?? "_none"
              }
              onValueChange={(next) => setOverrides({
                ...overrides,
                customers: {
                  ...overrides.customers,
                  [item.sourceKey]: next === "_create"
                    ? { createName: item.sourceLabel }
                    : { customerId: next },
                },
              })}
            >
              <SelectTrigger aria-label={`Customer mapping for ${item.sourceLabel}`}>
                <SelectValue placeholder="Select customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none" disabled>Select customer</SelectItem>
                <SelectItem value="_create">Create distributor “{item.sourceLabel}”</SelectItem>
                {plan.options.customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        {plan.unresolved.brands.map((item) => (
          <div key={item.sourceKey} className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center">
            <div className="text-sm font-medium">{item.sourceLabel}</div>
            <BrandMappingFields
              item={item}
              plan={plan}
              value={overrides.brands?.[item.sourceKey] ?? {}}
              onChange={(value) => setOverrides({
                ...overrides,
                brands: { ...overrides.brands, [item.sourceKey]: value },
              })}
            />
          </div>
        ))}
        <Button onClick={onRepreview} disabled={!mappingsComplete || pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Re-run preview with mappings
        </Button>
      </CardContent>
    </Card>
  );
}

function RunHistory({
  runs,
  loading,
  error,
  onRetry,
}: {
  runs: BeerOrderImportRun[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import history</CardTitle>
        <CardDescription>Recent previews and applied reconciliations.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Import history unavailable</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>Check the integration database setup, then try again.</span>
              <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
            </AlertDescription>
          </Alert>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No spreadsheet imports yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Changes</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">{run.filename}</TableCell>
                  <TableCell>
                    <Badge variant={run.status === "failed" ? "destructive" : run.status === "applied" ? "default" : "secondary"}>
                      {run.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {run.summary.createdOrders ?? 0} create / {run.summary.updatedOrders ?? 0} update
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDistanceToNow(new Date(run.applied_at ?? run.created_at), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function BeerOrderSyncPanel() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [overrides, setOverrides] = useState<BeerOrderMappingOverrides>({});
  const [applied, setApplied] = useState(false);

  const history = useQuery({
    queryKey: beerOrderImportKeys.runs(),
    queryFn: async () => responseData<BeerOrderImportRun[]>(
      await fetch("/api/integrations/beer-orders/runs"),
    ),
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a workbook first");
      const form = new FormData();
      form.set("file", file);
      form.set("mappings", JSON.stringify(overrides));
      return responseData<PreviewResponse>(await fetch("/api/integrations/beer-orders/preview", {
        method: "POST",
        body: form,
      }));
    },
    onSuccess: (result) => {
      setPreview(result);
      setApplied(false);
      toast.success(result.plan.ready ? "Preview ready to apply" : "Preview needs mappings");
      queryClient.invalidateQueries({ queryKey: beerOrderImportKeys.runs() });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Run a preview first");
      return responseData<{ runId: string }>(await fetch("/api/integrations/beer-orders/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: preview.runId }),
      }));
    },
    onSuccess: () => {
      setApplied(true);
      toast.success("Beer orders reconciled");
      queryClient.invalidateQueries({ queryKey: beerOrderImportKeys.runs() });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const hasUnresolved = Boolean(
    preview && (preview.plan.unresolved.customers.length || preview.plan.unresolved.brands.length),
  );
  const fileLabel = useMemo(() => file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MiB` : null, [file]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload workbook</CardTitle>
          <CardDescription>
            Preview is read-only. MongoDB is never consulted, In House blocks are skipped,
            and missing spreadsheet orders are never automatically deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileUpload
            value={file ? [file] : []}
            onValueChange={(files) => {
              setFile(files[0] ?? null);
              setPreview(null);
              setOverrides({});
              setApplied(false);
            }}
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            maxFiles={1}
            maxSize={MAX_FILE_SIZE}
            onFileReject={(_rejected, message) => toast.error(message)}
          >
            <FileUploadDropzone>
              <Upload className="h-6 w-6 text-muted-foreground" />
              <div className="text-sm font-medium">Drop Beer orders.xlsx here or choose a file</div>
              <div className="text-xs text-muted-foreground">Excel .xlsx, up to 4 MiB</div>
            </FileUploadDropzone>
          </FileUpload>
          {fileLabel && <p className="text-sm text-muted-foreground">{fileLabel}</p>}
          <Button onClick={() => previewMutation.mutate()} disabled={!file || previewMutation.isPending}>
            {previewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Preview reconciliation
          </Button>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Reconciliation preview</CardTitle>
                <CardDescription>{preview.filename} · SHA-256 {preview.sha256.slice(0, 12)}…</CardDescription>
              </div>
              <Badge variant={preview.plan.ready ? "default" : "secondary"}>
                {preview.plan.ready ? "Ready" : "Mappings needed"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <SummaryGrid plan={preview.plan} />
            {preview.plan.summary.staleOrders > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{preview.plan.summary.staleOrders} orders are absent from this workbook</AlertTitle>
                <AlertDescription>They are reported for review and will not be changed or deleted.</AlertDescription>
              </Alert>
            )}
            {applied ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Reconciliation applied</AlertTitle>
                <AlertDescription>The transaction completed and the import was added to history.</AlertDescription>
              </Alert>
            ) : preview.plan.ready && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={applyMutation.isPending}>Apply reconciliation</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Apply these spreadsheet changes?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will create {preview.plan.summary.createdOrders} orders and update {preview.plan.summary.updatedOrders} orders in one transaction. Existing statuses are preserved.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => applyMutation.mutate()}>Apply reconciliation</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </CardContent>
        </Card>
      )}

      {preview && hasUnresolved && (
        <MappingPanel
          preview={preview}
          overrides={overrides}
          setOverrides={setOverrides}
          onRepreview={() => previewMutation.mutate()}
          pending={previewMutation.isPending}
        />
      )}

      <RunHistory
        runs={history.data ?? []}
        loading={history.isLoading}
        error={history.isError}
        onRetry={() => void history.refetch()}
      />
    </div>
  );
}
