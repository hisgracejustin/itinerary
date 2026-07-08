/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1a73e8',
          dark: '#1557b0',
          light: '#e8f0fe',
        },
        surface: {
          DEFAULT: '#ffffff',
          dim: '#f8f9fa',
          container: '#f1f3f4',
        },
        on: {
          surface: '#202124',
          'surface-variant': '#5f6368',
        },
        outline: {
          DEFAULT: '#dadce0',
          variant: '#e8eaed',
        },
        flight: '#1a73e8',
        train: '#0d652d',
        bus: '#0d9488',
        cruise: '#7627bb',
        hotel: '#e37400',
        activity: '#c5221f',
      },
      fontFamily: {
        sans: ['Inter', 'Google Sans', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        'elevation-1': '0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15)',
        'elevation-2': '0 1px 2px 0 rgba(60,64,67,0.3), 0 2px 6px 2px rgba(60,64,67,0.15)',
        'elevation-3': '0 4px 8px 3px rgba(60,64,67,0.15), 0 1px 3px rgba(60,64,67,0.3)',
        'elevation-4': '0 6px 10px 4px rgba(60,64,67,0.15), 0 2px 3px rgba(60,64,67,0.3)',
      },
      transitionTimingFunction: {
        'material': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'material-decel': 'cubic-bezier(0, 0, 0.2, 1)',
        'material-accel': 'cubic-bezier(0.4, 0, 1, 1)',
      },
    },
  },
  plugins: [],
}
