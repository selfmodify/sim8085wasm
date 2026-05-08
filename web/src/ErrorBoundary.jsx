import { Component } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel" style={{ padding: 12, color: 'var(--red)', fontSize: 13 }}>
          <strong>Panel error:</strong> {this.state.error.message}
          <br />
          <button className="btn btn-xs" style={{ marginTop: 8 }} onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
