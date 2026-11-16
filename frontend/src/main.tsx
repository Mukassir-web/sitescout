import { StrictMode, lazy, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./index.css";
import { usePath } from "./site/router";
import Landing from "./site/Landing";

const App = lazy(() => import("./App"));
const HowItWorks = lazy(() => import("./site/HowItWorks"));

function Root() {
  const path = usePath().replace(/\/+$/, "") || "/";
  useEffect(() => {
    document.title = path === "/app" ? "SiteScout · App" : path === "/how-it-works" ? "SiteScout · How it works" : "SiteScout · Ask any website";
  }, [path]);
  return (
    <Suspense fallback={null}>
      {path === "/app" ? <App /> : path === "/how-it-works" ? <HowItWorks /> : <Landing />}
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Root />
    </MotionConfig>
  </StrictMode>,
);
