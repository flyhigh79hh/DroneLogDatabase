import { useEffect, useState, useCallback } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { getFlightById, updateFlight, getBatteryPacks, getFlightGpx, getFlightKml, updateFlightLocationAltitudeOffset, getSetting } from '../services/api';
import MapDisplay from '../components/MapDisplay';
import MapDisplay3D from '../components/MapDisplay3D';
import BatteryChart from '../components/BatteryChart';
import SignalChart from '../components/SignalChart';
import NotesEditor from '../components/NotesEditor';
import {
  Box,
  Button,
  Typography,
  Paper,
  Grid,
  CircularProgress,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  OutlinedInput,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Switch,
  FormControlLabel,
  TextField
} from '@mui/material';
import { MdArrowBack, MdExpandMore } from 'react-icons/md';

// Interfaces
interface FlightLocation { id: number; name: string; latitude: number; longitude: number; altitude_offset?: number; }
interface FlightDataPoint { id: number; timestamp: string; latitude?: number; longitude?: number; altitude?: number; speed?: number; rx_bt?: number; rssi?: number; rqly?: number; distance_from_start?: number; }
interface BatteryPack { id: number; name: string; number: string; }
interface Pilot { id: number; name: string; }
interface Drone { id: number; name: string; }
interface Flight { id: number; pilot_id: number; drone_id: number; flight_date: string; notes?: string; csv_log_path?: string; flight_location?: FlightLocation; flight_data: FlightDataPoint[]; battery_packs: BatteryPack[]; pilot: Pilot; drone: Drone; }

const formatDuration = (seconds: number) => new Date(seconds * 1000).toISOString().substr(11, 8);

const MetricCard = ({ title, value }: { title: string, value: string }) => (
  <Grid item xs={6} sm={3}>
    <Paper sx={{ p: 2, textAlign: 'center' }}>
      <Typography variant="subtitle1" color="text.secondary">{title}</Typography>
      <Typography variant="h5">{value}</Typography>
    </Paper>
  </Grid>
);

const handleExport = async (flightId: number, format: 'gpx' | 'kml') => {
  const response = await (format === 'gpx' ? getFlightGpx(flightId) : getFlightKml(flightId));
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `flight_${flightId}.${format}`);
  document.body.appendChild(link);
  link.click();
  link.parentNode?.removeChild(link);
};

function FlightDetail() {
  const { id } = useParams<{ id: string }>();
  const flightId = parseInt(id || '');
  const [flight, setFlight] = useState<Flight | null>(null);
  const [batteryPacks, setBatteryPacks] = useState<BatteryPack[]>([]);
  const [selectedBatteryPacks, setSelectedBatteryPacks] = useState<number[]>([]);
  const [isEditingBatteries, setIsEditingBatteries] = useState(false);
  const [showAllMapPoints, setShowAllMapPoints] = useState(true);
  const [is3DView, setIs3DView] = useState(false);
  const [altitudeOffset, setAltitudeOffset] = useState(50);
  const [showDipulMapLink, setShowDipulMapLink] = useState(true);
  const [dateFormat, setDateFormat] = useState('MM/DD/YYYY');
  const [timeFormat, setTimeFormat] = useState('HH:mm:ss');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const showDipulMapLinkRes = await getSetting('show_dipul_map_link');
        setShowDipulMapLink(showDipulMapLinkRes.data.value === 'true');
        const dateFormatRes = await getSetting('date_format');
        setDateFormat(dateFormatRes.data.value);
        const timeFormatRes = await getSetting('time_format');
        setTimeFormat(timeFormatRes.data.value);
      } catch (error) {
        console.error("Error fetching settings:", error);
      }
    };
    fetchSettings();
  }, []);

  const formatDate = (date: Date) => {
    const options: Intl.DateTimeFormatOptions = {
      year: dateFormat.includes('YYYY') ? 'numeric' : undefined,
      month: dateFormat.includes('MM') ? '2-digit' : undefined,
      day: dateFormat.includes('DD') ? '2-digit' : undefined,
    };
    return new Intl.DateTimeFormat(undefined, options).format(date);
  };

  const formatTime = (date: Date) => {
    const options: Intl.DateTimeFormatOptions = {
      hour: timeFormat.includes('HH') || timeFormat.includes('h') ? '2-digit' : undefined,
      minute: timeFormat.includes('mm') ? '2-digit' : undefined,
      second: timeFormat.includes('ss') ? '2-digit' : undefined,
      hour12: timeFormat.includes('a'),
    };
    return new Intl.DateTimeFormat(undefined, options).format(date);
  };

  const fetchFlightDetails = useCallback(async () => {
    const response = await getFlightById(flightId);
    setFlight(response.data);
    setSelectedBatteryPacks(response.data.battery_packs.map((p: BatteryPack) => p.id));
    if (response.data.flight_location && response.data.flight_location.altitude_offset) {
      setAltitudeOffset(response.data.flight_location.altitude_offset);
    }
  }, [flightId]);

  const fetchBatteryPacks = useCallback(async () => {
    const response = await getBatteryPacks();
    setBatteryPacks(response.data);
  }, []);

  useEffect(() => {
    if (flightId) {
      fetchFlightDetails();
      fetchBatteryPacks();
    }
  }, [flightId, fetchFlightDetails, fetchBatteryPacks]);

  useEffect(() => {
    if (!flight || !flight.flight_location) return;

    const handler = setTimeout(() => {
      updateFlightLocationAltitudeOffset(flight.flight_location!.id, altitudeOffset);
    }, 1000); // Debounce time in ms

    return () => {
      clearTimeout(handler);
    };
  }, [altitudeOffset, flight]);

  const handleSaveNotes = async (newNotes: string) => {
    if (!flight) return;
    await updateFlight(flight.id, flight.pilot_id, flight.drone_id, flight.flight_date, newNotes);
    fetchFlightDetails();
  };

  const handleSaveBatteryPacks = async () => {
    if (!flight) return;
    await updateFlight(flight.id, flight.pilot_id, flight.drone_id, flight.flight_date, flight.notes, selectedBatteryPacks);
    setIsEditingBatteries(false);
    fetchFlightDetails();
  };

  if (!flight) return <CircularProgress />;

  const startTime = flight.flight_data.length > 0 ? new Date(flight.flight_data[0].timestamp).getTime() : 0;
  const filteredFlightData = flight.flight_data.filter((dp: FlightDataPoint) => (dp.rx_bt || 0) > 0);
  const chartLabels = filteredFlightData.map((dp: FlightDataPoint) => new Date(dp.timestamp).toLocaleTimeString());
  const flightDuration = flight.flight_data.length > 1 ? (new Date(flight.flight_data[flight.flight_data.length - 1].timestamp).getTime() - startTime) / 1000 : 0;
  const maxAltitude = Math.max(...flight.flight_data.map((dp: FlightDataPoint) => dp.altitude || 0), 0);
  const maxSpeed = Math.max(...flight.flight_data.map((dp: FlightDataPoint) => dp.speed || 0), 0);
  const maxDistance = Math.max(...flight.flight_data.map((dp: FlightDataPoint) => dp.distance_from_start || 0), 0);
  const chartData = filteredFlightData.map((dp: FlightDataPoint) => ({ timestamp: dp.timestamp, rxBt: dp.rx_bt || 0, rssi: dp.rssi || 0, rqly: dp.rqly || 0, distance_from_start: dp.distance_from_start || 0 }));
  const logFileName = flight.csv_log_path ? flight.csv_log_path.replace(/[\\/]/g, '/').split('/').pop() : '';

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Button component={RouterLink} to="/flights" startIcon={<MdArrowBack />}>Back to Flights</Button>
        <Box>
          <Button onClick={() => handleExport(flightId, 'gpx')} sx={{ mr: 1 }}>Export GPX</Button>
          <Button onClick={() => handleExport(flightId, 'kml')}>Export KML</Button>
        </Box>
      </Box>
      <Typography variant="h4" gutterBottom>Flight on {formatDate(new Date(flight.flight_date))}</Typography>

      <Grid container spacing={3}>
        <MetricCard title="Duration" value={formatDuration(flightDuration)} />
        <MetricCard title="Max Altitude" value={`${maxAltitude.toFixed(1)} m`} />
        <MetricCard title="Max Speed" value={`${maxSpeed.toFixed(1)} km/h`} />
        <MetricCard title="Max Distance" value={`${maxDistance.toFixed(1)} m`} />

        <Grid item xs={12} md={5} container spacing={3} direction="column">
          <Grid item><Paper sx={{ p: 2 }}>
            <Typography variant="h6">Details</Typography>
            <Typography><strong>Pilot:</strong> {flight.pilot?.name || 'N/A'}</Typography>
            <Typography><strong>Drone:</strong> {flight.drone?.name || 'N/A'}</Typography>
            <Typography>
              <strong>Location:</strong> {flight.flight_location?.name || 'N/A'}
              {showDipulMapLink && flight.flight_location && (
                <a href={`https://maptool-dipul.dfs.de/geozones/@${flight.flight_location.longitude},${flight.flight_location.latitude}?zoom=15.0`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '10px' }}>
                  dipul map
                </a>
              )}
            </Typography>
            <Typography><strong>Time:</strong> {startTime ? formatTime(new Date(startTime)) : 'N/A'}</Typography>
            {logFileName && <Typography><strong>Log File:</strong> {logFileName}</Typography>}
          </Paper></Grid>
          <Grid item><Paper sx={{ p: 2 }}>
            <NotesEditor initialNotes={flight.notes || ''} onSave={handleSaveNotes} />
          </Paper></Grid>
          <Grid item><Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Battery Packs</Typography>
            {isEditingBatteries ? (
              <Box>
                <FormControl fullWidth>
                  <InputLabel>Packs</InputLabel>
                  <Select multiple value={selectedBatteryPacks} onChange={(e) => setSelectedBatteryPacks(e.target.value as number[])} input={<OutlinedInput label="Packs" />} renderValue={(selected) => (<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>{selected.map((id: number) => <Chip key={id} label={batteryPacks.find(p=>p.id===id)?.number} />)}</Box>)}> 
                    {batteryPacks.map((pack: BatteryPack) => <MenuItem key={pack.id} value={pack.id}>{pack.number} - {pack.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <Box sx={{ mt: 2 }}><Button onClick={handleSaveBatteryPacks}>Save</Button><Button onClick={() => setIsEditingBatteries(false)} sx={{ ml: 1 }}>Cancel</Button></Box>
              </Box>
            ) : (
              <Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>{flight.battery_packs.map((pack: BatteryPack) => <Chip key={pack.id} label={`${pack.number} - ${pack.name}`} />)}</Box>
                <Button onClick={() => setIsEditingBatteries(true)}>Edit</Button>
              </Box>
            )}
          </Paper></Grid>
        </Grid>

        <Grid item xs={12} md={7}>
          <Paper sx={{ height: '450px', p: 2, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6" gutterBottom>Flight Path</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                {is3DView && (
                  <TextField
                    label="Altitude Offset"
                    type="number"
                    value={altitudeOffset}
                    onChange={(e) => setAltitudeOffset(Number(e.target.value))}
                    size="small"
                    sx={{ mr: 2, width: '120px' }}
                  />
                )}
                <Button onClick={() => setIs3DView(!is3DView)}>{is3DView ? '2D View' : '3D View'}</Button>
              </Box>
            </Box>
            <Box sx={{ flexGrow: 1, position: 'relative', height: '100%' }}>
              {flight.flight_data.length > 0 ? (
                is3DView ? (
                  <MapDisplay3D flightData={flight.flight_data} altitudeOffset={altitudeOffset} />
                ) : (
                  <MapDisplay flightData={flight.flight_data} showAllPoints={showAllMapPoints} />
                )
              ) : (
                <Typography sx={{ textAlign: 'center', mt: 2 }}>No GPS data available for this flight.</Typography>
              )}
            </Box>
            {flight.flight_data.length > 0 && !is3DView && (
              <FormControlLabel
                control={<Switch checked={showAllMapPoints} onChange={(e) => setShowAllMapPoints(e.target.checked)} name="show-all-points" id="show-all-points-switch" />}
                label="Show all track points"
                sx={{ pt: 1, justifyContent: 'center' }}
              />
            )}
          </Paper>
        </Grid>

        {chartData.length > 0 && (
          <>
            <Grid item xs={12}>
              <Paper sx={{ p: 2, height: '300px', overflow: 'hidden' }}>
                <Typography variant="h6">Battery Voltage</Typography>
                <BatteryChart flightData={chartData} labels={chartLabels} />
              </Paper>
            </Grid>
            <Grid item xs={12}>
              <Paper sx={{ p: 2, height: '300px', overflow: 'hidden' }}>
                <Typography variant="h6">Signal Strength</Typography>
                <SignalChart flightData={chartData} labels={chartLabels} />
              </Paper>
            </Grid>
          </>
        )}

        <Grid item xs={12}>
          <Accordion>
            <AccordionSummary expandIcon={<MdExpandMore />}><Typography>Raw Flight Data</Typography></AccordionSummary>
            <AccordionDetails><TableContainer component={Paper} sx={{maxHeight: 400}}><Table stickyHeader size="small">
              <TableHead><TableRow><TableCell>Time</TableCell><TableCell>Alt (m)</TableCell><TableCell>Speed (km/h)</TableCell><TableCell>Dist (m)</TableCell><TableCell>RSSI (dB)</TableCell><TableCell>RQLY (%)</TableCell><TableCell>Voltage (V)</TableCell></TableRow></TableHead>
              <TableBody>{flight.flight_data.map((dp: FlightDataPoint) => <TableRow key={dp.id}><td>{new Date(dp.timestamp).toLocaleTimeString()}</td><td>{dp.altitude?.toFixed(1)}</td><td>{dp.speed?.toFixed(1)}</td><td>{dp.distance_from_start?.toFixed(1)}</td><td>{dp.rssi}</td><td>{dp.rqly}</td><td>{dp.rx_bt?.toFixed(2)}</td></TableRow>)}</TableBody>
            </Table></TableContainer></AccordionDetails>
          </Accordion>
        </Grid>
      </Grid>
    </Box>
  );
}

export default FlightDetail;