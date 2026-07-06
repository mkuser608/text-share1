import React from 'react'
import Landing from './components/Landing'
import Room from './components/Room'

export default function App() {
  const key = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ''))
  if (!key) return <Landing />
  return <Room roomKey={key} />
}
