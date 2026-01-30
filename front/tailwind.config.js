/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#C25E46',
        'primary-hover': '#A04530',

        secondary: '#6B665F',
        'bg-main': '#F2F0E9',
        'bg-card': '#FDFBF7',
        border: '#EAE5D9',
        placeholder: '#BDB8AE',
        'success-text': '#2E5C38',
      },
      fontFamily: {
        heading: ['Merriweather', 'serif'],
        body: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '2rem',
      },
      boxShadow: {
        'card': '0 10px 30px -5px rgba(0, 0, 0, 0.05)',
      }
    },
  },
  plugins: [],
}
