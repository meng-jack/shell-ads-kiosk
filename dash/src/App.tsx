import { Routes, Route } from "react-router-dom";
import Submit from "./pages/Submit";

// SECURITY: Admin dashboard removed from static build to prevent reverse engineering.
// Admin functionality is served separately via authenticated API endpoints only.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Submit />} />
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
