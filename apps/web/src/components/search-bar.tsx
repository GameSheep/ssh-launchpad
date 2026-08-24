export function SearchBar({ value, onChange, onAdd }: { value: string; onChange(value: string): void; onAdd(): void }) {
  return <div className="search-row"><div className="search-box"><span className="search-mark">⌕</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder="搜索服务器、应用或地址" /><kbd>⌘ K</kbd></div><button className="primary small" onClick={onAdd}>＋ 添加</button></div>
}
