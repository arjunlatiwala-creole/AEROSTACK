export const toasterConfig = {
  duration: 4000,
  style: {
    background: '#000',
    color: '#fff',
    border: '1px solid #e4e7ec',
    borderRadius: '10px',
    padding: '12px 16px',
    fontSize: '14px',
    fontWeight: '500',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.08)',
  },
  success: {
    iconTheme: {
      primary: '#b6ffbb',
      secondary: '#002d43',
    },
    style: {
      border: '1px solid #b6ffbb',
    },
  },
  error: {
    iconTheme: {
      primary: '#ff66b2',
      secondary: '#ffffff',
    },
    style: {
      border: '1px solid #ff66b2',
    },
  },
  loading: {
    iconTheme: {
      primary: '#0096ff',
      secondary: '#ffffff',
    },
    style: {
      border: '1px solid #0096ff',
    },
  },
  } as const
