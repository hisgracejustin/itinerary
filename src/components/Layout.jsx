import { useState, useRef, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Header from './Header'
import Sidebar from './Sidebar'
import { useTripMeta } from '../hooks/useBookings'

export default function Layout() {
  const [selectedTrip, setSelectedTrip] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768)
  const onOpenAdd = useRef(null)
  const { tripMeta } = useTripMeta(selectedTrip)

  // Close sidebar on mobile when navigating
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) setSidebarOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="absolute inset-0 flex flex-row bg-surface-dim pb-[env(safe-area-inset-bottom)]">
      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 bg-black/40 z-20 md:hidden transition-opacity duration-300 ease-material ${
          sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setSidebarOpen(false)}
      />
      {/* Sidebar - full height */}
      <div
        className={`fixed md:relative z-30 inset-y-0 left-0 md:inset-auto md:h-full transition-all duration-300 ease-material ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:-translate-x-full md:w-0 md:overflow-hidden'
        }`}
      >
        <Sidebar
          selectedTrip={selectedTrip}
          onSelectTrip={(trip) => {
            setSelectedTrip(trip)
            if (window.innerWidth < 768) setSidebarOpen(false)
          }}
          onNavigate={() => {
            if (window.innerWidth < 768) setSidebarOpen(false)
          }}
        />
      </div>
      {/* Right side: header + content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onAddBooking={() => onOpenAdd.current?.()}
        />
        <main className="flex-1 overflow-auto bg-surface-dim p-3 sm:p-5">
          <Outlet context={{ selectedTrip, tripMeta, onOpenAdd }} />
        </main>
      </div>
    </div>
  )
}
