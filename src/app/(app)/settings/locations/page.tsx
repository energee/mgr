"use client";

/**
 * Locations Management Page
 *
 * CRUD for brewery locations (warehouses, taproom, etc.)
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Pencil, Trash2, MapPin, Building2, Store, Warehouse } from "lucide-react";
import Link from "next/link";

const locationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  location_type: z.enum(["brewery", "warehouse", "taproom", "offsite"]),
  is_primary: z.boolean().optional(),
  is_active: z.boolean().optional(),
  address_street: z.string().nullable().optional(),
  address_city: z.string().nullable().optional(),
  address_state: z.string().nullable().optional(),
  address_zip: z.string().nullable().optional(),
});

type LocationFormValues = z.infer<typeof locationSchema>;

interface Location {
  id: string;
  name: string;
  location_type: string;
  is_primary: boolean;
  is_active: boolean;
  address: { street?: string; city?: string; state?: string; zip?: string } | null;
  created_at: string;
}

const locationTypeIcons: Record<string, typeof MapPin> = {
  brewery: Building2,
  warehouse: Warehouse,
  taproom: Store,
  offsite: MapPin,
};

const locationTypeLabels: Record<string, string> = {
  brewery: "Brewery",
  warehouse: "Warehouse",
  taproom: "Taproom",
  offsite: "Offsite",
};

export default function LocationsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: locations, isLoading } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .order("is_primary", { ascending: false })
        .order("name");
      if (error) throw error;
      return data as Location[];
    },
  });

  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      name: "",
      location_type: "warehouse",
      is_primary: false,
      is_active: true,
      address_street: "",
      address_city: "",
      address_state: "",
      address_zip: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: LocationFormValues) => {
      const { error } = await supabase.from("locations").insert({
        name: values.name,
        location_type: values.location_type,
        is_primary: values.is_primary,
        is_active: values.is_active,
        address: {
          street: values.address_street || null,
          city: values.address_city || null,
          state: values.address_state || null,
          zip: values.address_zip || null,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      setIsDialogOpen(false);
      form.reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: LocationFormValues }) => {
      const { error } = await supabase
        .from("locations")
        .update({
          name: values.name,
          location_type: values.location_type,
          is_primary: values.is_primary,
          is_active: values.is_active,
          address: {
            street: values.address_street || null,
            city: values.address_city || null,
            state: values.address_state || null,
            zip: values.address_zip || null,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      setIsDialogOpen(false);
      setEditingLocation(null);
      form.reset();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("locations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
    },
  });

  const openEditDialog = (location: Location) => {
    setEditingLocation(location);
    form.reset({
      name: location.name,
      location_type: location.location_type as LocationFormValues["location_type"],
      is_primary: location.is_primary,
      is_active: location.is_active,
      address_street: location.address?.street || "",
      address_city: location.address?.city || "",
      address_state: location.address?.state || "",
      address_zip: location.address?.zip || "",
    });
    setIsDialogOpen(true);
  };

  const openCreateDialog = () => {
    setEditingLocation(null);
    form.reset({
      name: "",
      location_type: "warehouse",
      is_primary: false,
      is_active: true,
      address_street: "",
      address_city: "",
      address_state: "",
      address_zip: "",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (values: LocationFormValues) => {
    if (editingLocation) {
      updateMutation.mutate({ id: editingLocation.id, values });
    } else {
      createMutation.mutate(values);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this location?")) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/settings">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Locations</h1>
            <p className="text-muted-foreground">Manage your facilities and warehouses</p>
          </div>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Add Location
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{editingLocation ? "Edit Location" : "Add Location"}</DialogTitle>
              <DialogDescription>
                {editingLocation ? "Update the location details below." : "Add a new facility or warehouse."}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" {...form.register("name")} placeholder="e.g., Main Warehouse" />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="location_type">Type</Label>
                <select
                  id="location_type"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...form.register("location_type")}
                >
                  <option value="brewery">Brewery</option>
                  <option value="warehouse">Warehouse</option>
                  <option value="taproom">Taproom</option>
                  <option value="offsite">Offsite</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address_street">Street Address</Label>
                <Input id="address_street" {...form.register("address_street")} />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-2">
                  <Label htmlFor="address_city">City</Label>
                  <Input id="address_city" {...form.register("address_city")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address_state">State</Label>
                  <Input id="address_state" {...form.register("address_state")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address_zip">ZIP</Label>
                  <Input id="address_zip" {...form.register("address_zip")} />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_primary"
                    checked={form.watch("is_primary")}
                    onCheckedChange={(checked) => form.setValue("is_primary", checked)}
                  />
                  <Label htmlFor="is_primary">Primary Location</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_active"
                    checked={form.watch("is_active")}
                    onCheckedChange={(checked) => form.setValue("is_active", checked)}
                  />
                  <Label htmlFor="is_active">Active</Label>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {locations && locations.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {locations.map((location) => {
            const Icon = locationTypeIcons[location.location_type] || MapPin;
            return (
              <Card key={location.id} className={!location.is_active ? "opacity-60" : ""}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {location.name}
                        {location.is_primary && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                            Primary
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription>{locationTypeLabels[location.location_type]}</CardDescription>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(location)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {!location.is_primary && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(location.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {location.address && (location.address.street || location.address.city) ? (
                    <p className="text-sm text-muted-foreground">
                      {location.address.street && <span>{location.address.street}<br /></span>}
                      {location.address.city && `${location.address.city}, `}
                      {location.address.state} {location.address.zip}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No address set</p>
                  )}
                  {!location.is_active && (
                    <p className="text-sm text-muted-foreground mt-2">Inactive</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MapPin className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground mb-4">No locations configured</p>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Location
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
