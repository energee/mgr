import { Suspense } from "react";
import { PortalLoginForm } from "./portal-login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function PortalLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Customer Portal</CardTitle>
          <CardDescription>Enter your email to sign in</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<div className="h-48 animate-pulse" />}>
            <PortalLoginForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
