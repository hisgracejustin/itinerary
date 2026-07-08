import { Routes, Route } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Calendar from './pages/Calendar'
import Todos from './pages/Todos'
import BookingsByType from './pages/BookingsByType'
import Costs from './pages/Costs'
import Login from './pages/Login'
import Spinner from './components/Spinner'

export default function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-dim">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Calendar />} />
        <Route path="todos" element={<Todos />} />
        <Route path="costs" element={<Costs />} />
        <Route path="bookings/:type" element={<BookingsByType />} />
      </Route>
    </Routes>
  )
}
