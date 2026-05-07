function App() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col items-center justify-center p-8 transition-colors duration-300">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-10 shadow-xl text-center space-y-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-black tracking-tight">New Project</h1>
          <p className="text-slate-500 dark:text-slate-400 font-medium uppercase tracking-widest text-xs">
            Ready to Build
          </p>
        </div>
        <p className="text-sm text-slate-400 dark:text-slate-500">
          Edit <code className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">src/App.tsx</code> to get started.
          <br />
          Deploy from the dashboard when you're ready.
        </p>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 dark:text-slate-700 pt-4">
          Local Environment Ready
        </p>
      </div>
    </div>
  )
}

export default App
