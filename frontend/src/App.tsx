import { BrowserRouter as Router, Routes, Route, Link as RouterLink } from 'react-router-dom';
import Pilots from './pages/Pilots';
import Drones from './pages/Drones';
import Flights from './pages/Flights';
import FlightDetail from './pages/FlightDetail';
import DroneDetail from './pages/DroneDetail';
import FlightLocations from './pages/FlightLocations';
import BatteryPacks from './pages/BatteryPacks';
import BatteryPackDetail from './pages/BatteryPackDetail';
import Admin from './pages/Admin';
import Dashboard from './pages/Dashboard';
import './App.css';
import 'leaflet/dist/leaflet.css';

import CssBaseline from '@mui/material/CssBaseline';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';

const navItems = [
  { label: 'Dashboard', path: '/' },
  { label: 'Pilots', path: '/pilots' },
  { label: 'Drones', path: '/drones' },
  { label: 'Flights', path: '/flights' },
  { label: 'Locations', path: '/locations' },
  { label: 'Batteries', path: '/batteries' },
  { label: 'Admin', path: '/admin' },
];

function App() {
  return (
    <Box sx={{ flexGrow: 1 }}>
      <CssBaseline />
      <Router>
        <AppBar position="static" sx={{ bgcolor: '#212121' }}>
          <Toolbar>
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              DroneLogger
            </Typography>
            <Box>
              {navItems.map((item) => (
                <Button
                  key={item.label}
                  component={RouterLink}
                  to={item.path}
                  sx={{ color: '#fff' }}
                >
                  {item.label}
                </Button>
              ))}
            </Box>
          </Toolbar>
        </AppBar>

        <Container sx={{ mt: 4 }}>
          <Routes>
            <Route path="/pilots" element={<Pilots />} />
            <Route path="/drones" element={<Drones />} />
            <Route path="/drones/:id" element={<DroneDetail />} />
            <Route path="/flights" element={<Flights />} />
            <Route path="/flights/:id" element={<FlightDetail />} />
            <Route path="/locations" element={<FlightLocations />} />
            <Route path="/batteries" element={<BatteryPacks />} />
            <Route path="/batteries/:id" element={<BatteryPackDetail />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/" element={<Dashboard />} />
          </Routes>
        </Container>
      </Router>
    </Box>
  );
}

export default App;