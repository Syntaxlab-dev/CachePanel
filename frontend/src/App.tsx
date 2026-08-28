import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { Steam } from "@/pages/Steam";
import { BattleNet } from "@/pages/BattleNet";
import { Epic } from "@/pages/Epic";
import { Settings } from "@/pages/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="steam" element={<Steam />} />
          <Route path="battlenet" element={<BattleNet />} />
          <Route path="epic" element={<Epic />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
