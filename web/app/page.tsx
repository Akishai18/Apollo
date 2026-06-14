import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { VerdictTicker } from "@/components/verdict-ticker";
import { HowItWorks } from "@/components/how-it-works";
import { Showcase } from "@/components/showcase";
import { ValidationProof } from "@/components/validation-proof";
import { Examples } from "@/components/examples";
import { FinalCta } from "@/components/final-cta";
import { SiteFooter } from "@/components/site-footer";
import { ShaderBackground } from "@/components/shader-background";

export default function Home() {
  return (
    <>
      {/* dim, continuously-flowing ambient behind the whole page */}
      <ShaderBackground ambient className="fixed inset-0 -z-10 h-full w-full" />
      <div className="grain pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />

      <SiteHeader />
      <main>
        <Hero />
        <VerdictTicker />
        <HowItWorks />
        <Showcase />
        <ValidationProof />
        <Examples />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
