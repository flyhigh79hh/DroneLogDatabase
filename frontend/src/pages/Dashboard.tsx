import { useState, useEffect } from 'react';
import { getDashboardStatistics, getFlights } from '../services/api';
import { Box, Grid, Paper, Typography, CircularProgress, List, ListItem, ListItemText, Divider } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

interface DashboardStats {
  total_flights: number;
  total_pilots: number;
  total_drones: number;
  total_flight_duration_seconds: number;
}

interface Flight {
  id: number;
  flight_date: string;
  pilot: { name: string };
  drone: { name: string };
}

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentFlights, setRecentFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, recentFlightsRes] = await Promise.all([
          getDashboardStatistics(),
          getFlights(undefined, undefined, undefined, undefined, 0, 5) // Fetch 5 most recent flights
        ]);
        setStats(statsRes.data);
        setRecentFlights(recentFlightsRes.data.flights);
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return <CircularProgress />;
  }

  return (
    <Box sx={{ flexGrow: 1 }}>
      <Typography variant="h4" gutterBottom>Dashboard</Typography>
      <Grid container spacing={3}>
        {/* Stat Cards */}
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h6">Total Flights</Typography>
            <Typography variant="h4">{stats?.total_flights}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h6">Total Flight Time</Typography>
            <Typography variant="h4">{formatDuration(stats?.total_flight_duration_seconds || 0)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h6">Total Drones</Typography>
            <Typography variant="h4">{stats?.total_drones}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h6">Total Pilots</Typography>
            <Typography variant="h4">{stats?.total_pilots}</Typography>
          </Paper>
        </Grid>

        {/* Recent Flights */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Recent Flights</Typography>
            <List>
              {recentFlights.map((flight, index) => (
                <div key={flight.id}>
                  <ListItem button component={RouterLink} to={`/flights/${flight.id}`}>
                    <ListItemText
                      primary={`${flight.drone.name} with ${flight.pilot.name}`}
                      secondary={new Date(flight.flight_date).toLocaleDateString()}
                    />
                  </ListItem>
                  {index < recentFlights.length - 1 && <Divider />}
                </div>
              ))}
            </List>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

export default Dashboard;
