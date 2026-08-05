import { IconArrowLeft, IconInfoCircle } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { GraphView } from "../core/GraphView";
import type { GraphData, GraphProfile } from "../core/model";

interface GraphDemoPageProps {
  profile: GraphProfile;
  data: GraphData;
  // One sentence under the title: what this map answers for the user.
  lead: string;
}

// GraphDemoPage is the chrome the read-only graph profiles share: the same
// full-screen frame as the policies map, a title, and a banner saying the data
// is a sample. Both demos differ only in the profile and the data they pass.
export function GraphDemoPage({ profile, data, lead }: GraphDemoPageProps) {
  return (
    <div className="flex h-[calc(100vh-1px)] flex-col">
      <div className="flex items-center gap-4 border-b border-gray-200 bg-surface px-4 py-3">
        <Link
          to="/catalog"
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600"
        >
          <IconArrowLeft size={16} /> Портал
        </Link>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-slate-900">{profile.title}</h1>
          <p className="truncate text-xs text-slate-500">{lead}</p>
        </div>
      </div>

      <p className="flex items-center gap-2 border-b border-gray-200 bg-app px-4 py-2 text-xs text-slate-600">
        <IconInfoCircle size={14} className="shrink-0" />
        Данные на карте - пример. Подключение к реальному кластеру появится позже.
      </p>

      <div className="min-h-0 flex-1">
        <GraphView data={data} profile={profile} />
      </div>
    </div>
  );
}
