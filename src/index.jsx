/**
 * MARKDOWN EDITOR - Index Factory
 * Standard Datacore View Factory with Safe Agent recovery.
 */
async function View({ folderPath, dc, ...props }) {
  const Agent = {
    timer: null,
    start: (fPath, onReload) => {
      const cmdFile = fPath + "/data/mcp_commands.json";
      Agent.timer = setInterval(async () => {
        try {
          const adapter = dc.app.vault.adapter;
          if (!(await adapter.exists(cmdFile))) return;
          const content = await adapter.read(cmdFile);
          const cmd = JSON.parse(content);
          if (cmd && cmd.executed === false && cmd.action === "reload") {
            cmd.executed = true;
            cmd.executedAt = new Date().toISOString();
            await adapter.write(cmdFile, JSON.stringify(cmd, null, 2));
            onReload();
          }
        } catch (e) {}
      }, 1000);
      return () => clearInterval(Agent.timer);
    }
  };

  const SafeRoot = () => {
    const [modules, setModules] = dc.useState(null);
    const [error, setError] = dc.useState(null);
    const [key, setKey] = dc.useState(0);

    dc.useEffect(() => {
      return Agent.start(folderPath, () => {
        if (dc.app.workspace.activeLeaf?.rebuildView) {
          dc.app.workspace.activeLeaf.rebuildView();
        } else {
          setKey((k) => k + 1);
        }
      });
    }, []);

    dc.useEffect(() => {
      const load = async () => {
        try {
          const base = folderPath;
          const [app] = await Promise.all([
            dc.require(base + "/src/App.jsx")
          ]);
          setModules({
            MarkdownEditor: app.MarkdownEditor
          });
        } catch (e) {
          setError(e);
        }
      };
      load();
    }, [key]);

    if (error) {
      return (
        <div style={{ color: "red", padding: "40px", background: "var(--background-primary)", height: "100vh" }}>
          <h2 style={{ color: "var(--text-error)" }}>Critical Load Error</h2>
          <pre style={{ fontSize: "12px", color: "var(--text-error-alt)" }}>{error.stack}</pre>
        </div>
      );
    }
    if (!modules) {
      return (
        <div style={{ padding: "40px", background: "var(--background-primary)", color: "var(--text-muted)", height: "100vh", fontFamily: "monospace" }}>
          Initializing Markdown Editor...
        </div>
      );
    }

    const { MarkdownEditor: MainApp } = modules;
    return (
      <div id="datacore-component-root" style={{ width: "100%", height: "100%" }}>
        <MainApp folderPath={folderPath} dc={dc} {...props} />
      </div>
    );
  };

  return <SafeRoot />;
}

return { View };
