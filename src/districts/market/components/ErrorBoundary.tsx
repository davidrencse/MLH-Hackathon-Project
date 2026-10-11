import { Component, type ReactNode } from 'react';

/** Keeps a crash inside the Market District from blanking the whole city. */
export class MarketErrorBoundary extends Component<{ children: ReactNode; onExit?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mk-root" style={{ alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
        <div className="mk-glitch">MARKET DISTRICT OFFLINE</div>
        <div className="mk-note mk-note--err">{this.state.error.message}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="mk-btn mk-btn--primary" onClick={() => this.setState({ error: null })}>RETRY</button>
          {this.props.onExit && <button className="mk-btn mk-btn--ghost" onClick={this.props.onExit}>◀ CITY</button>}
        </div>
      </div>
    );
  }
}
