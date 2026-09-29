import { createRoot } from 'react-dom/client';
import { Component, type ReactNode } from 'react';
import App from './App';
import './styles.css';
class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main style={{ maxWidth: 650, margin: '10vh auto', padding: 24 }}>
        <h1>Не удалось отобразить отчёт</h1>
        <p>
          Исходные Excel-файлы сохранены. Можно сбросить настройки сопоставления и повторно открыть
          приложение.
        </p>
        <button
          className="button"
          onClick={() => {
            localStorage.removeItem('sales-compass-settings');
            location.reload();
          }}
        >
          Сбросить настройки и открыть заново
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <AppBoundary>
    <App />
  </AppBoundary>,
);
