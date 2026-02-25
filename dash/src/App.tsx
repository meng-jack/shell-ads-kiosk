import { Routes, Route } from "react-router-dom";
import Submit from "./pages/Submit";
import Admin from "./pages/Admin";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Submit />} />
      <Route path="/admin/*" element={<Admin />} />
    </Routes>
  );
}
