import { Routes, Route } from "react-router-dom";
import Submit from "./pages/Submit";
import Admin from "./pages/Admin";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Submit />} />
      <Route path="/admin" element={<Admin />} />
      <Route
        path="*"
        element={
          <div style={{ padding: "2rem", textAlign: "center" }}>
            <h2>404 - Page Not Found</h2>
            <p>The page you're looking for doesn't exist.</p>
          </div>
        }
      />
    </Routes>
  );
}
