import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Brain, Globe } from "lucide-react";
import ContentCreator from "@/components/aerostack/ContentCreator";
import EngagementTools from "@/components/aerostack/EngagementTools";
import BuilderTools from "@/components/aerostack/BuilderTools";

export default function DashboardEngagement() {
  const [activeView, setActiveView] = useState<
    "content" | "comms" | "websites"
  >("content");

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Brain className="w-9 h-9 text-purple-600" />
          <h1 className="text-4xl font-bold">Engagement & Content</h1>
        </div>
        <p className="text-lg text-muted-foreground">
          Strategic content pipeline + team communications — powered by Bedrock
          AgentCore
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="bg-linear-to-br from-purple-500 to-purple-700 text-white border-0">
          <CardHeader className="pb-2">
            <CardDescription className="text-purple-100">
              Agents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">3</div>
            <div className="text-xs text-purple-200 mt-1">
              Strategy · Content · Publisher
            </div>
          </CardContent>
        </Card>
        <Card className="bg-linear-to-br from-blue-500 to-cyan-500 text-white border-0">
          <CardHeader className="pb-2">
            <CardDescription className="text-blue-100">
              Knowledge Bases
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">9</div>
            <div className="text-xs text-blue-200 mt-1">
              Voice · Strategy · Stories · STAR · Playbook · Community · AWS ·
              Prior · Presentations
            </div>
          </CardContent>
        </Card>
        <Card className="bg-linear-to-br from-green-500 to-emerald-500 text-white border-0">
          <CardHeader className="pb-2">
            <CardDescription className="text-green-100">
              Pipeline Phases
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">5</div>
            <div className="text-xs text-green-200 mt-1">
              Strategy → Calendar → Draft → Review → Publish
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs
        value={activeView}
        onValueChange={(v) =>
          setActiveView(v as "content" | "comms" | "websites")
        }
      >
        <TabsList className="mb-6 bg-slate-200/70 p-1 rounded-lg">
          <TabsTrigger
            value="content"
            className="gap-2 data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md px-4 py-2 rounded-md transition-all"
          >
            <Brain className="w-4 h-4" /> Content Agent
          </TabsTrigger>
          <TabsTrigger
            value="comms"
            className="gap-2 data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md px-4 py-2 rounded-md transition-all"
          >
            <Sparkles className="w-4 h-4" /> Comms & Syndication
          </TabsTrigger>
          {/* <TabsTrigger
            value="websites"
            className="gap-2 data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md px-4 py-2 rounded-md transition-all"
          >
            <Globe className="w-4 h-4" /> Websites
          </TabsTrigger> */}
        </TabsList>

        <TabsContent value="content">
          <ContentCreator />
        </TabsContent>

        <TabsContent value="comms">
          <EngagementTools />
        </TabsContent>

        <TabsContent value="websites">
          <BuilderTools />
        </TabsContent>
      </Tabs>
    </div>
  );
}
