import { useState, useEffect, useCallback, useMemo } from 'react';
import { getFlights, createFlight, deleteFlight, getPilots, getDrones, getFlightLocations, assignFlightLocation, setFlightValidity, getSetting } from '../services/api';
import axios from 'axios';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Grid,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  TableSortLabel,
  TablePagination
} from '@mui/material';
import { MdDelete, MdUploadFile, MdBlock, MdCheckCircle, MdEdit, MdCancel } from 'react-icons/md';

// Interfaces
interface Pilot { id: number; name: string; }
interface Drone { id: number; name: string; }
interface FlightLocation { id: number; name: string; latitude: number; longitude: number; }
interface Flight {
  id: number;
  pilot_id: number;
  drone_id: number;
  flight_date: string;
  notes?: string;
  csv_log_path?: string;
  flight_location?: FlightLocation;
  pilot: Pilot;
  drone: Drone;
  is_valid: boolean;
  invalidation_notes?: string;
  duration?: number;
  flight_data: { timestamp: string }[];
}

// New interface for sortable columns
interface SortableFlight extends Flight {
  pilot_name: string;
  drone_name: string;
  location_name: string;
  duration: number;
}

// Sorting type
type Order = 'asc' | 'desc';

function descendingComparator<T>(a: T, b: T, orderBy: keyof T) {
  if (b[orderBy] < a[orderBy]) return -1;
  if (b[orderBy] > a[orderBy]) return 1;
  return 0;
}

function getComparator<T, Key extends keyof T>(
  order: Order,
  orderBy: Key,
): (a: T, b: T) => number {
  return order === 'desc'
    ? (a, b) => descendingComparator(a, b, orderBy)
    : (a, b) => -descendingComparator(a, b, orderBy);
}

function stableSort<T>(array: readonly T[], comparator: (a: T, b: T) => number) {
  const stabilizedThis = array.map((el, index) => [el, index] as [T, number]);
  stabilizedThis.sort((a, b) => {
    const order = comparator(a[0], b[0]);
    if (order !== 0) return order;
    return a[1] - b[1];
  });
  return stabilizedThis.map((el) => el[0]);
}

function formatDuration(seconds: number | undefined) {
  if (seconds === undefined || seconds === null) {
    return 'N/A';
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function Flights() {
  const [searchParams] = useSearchParams();
  const locationIdFromUrl = searchParams.get('location_id');
  const droneIdFromUrl = searchParams.get('drone_id');

  // State
  const [flights, setFlights] = useState<Flight[]>([]);
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [drones, setDrones] = useState<Drone[]>([]);
  const [flightLocations, setFlightLocations] = useState<FlightLocation[]>([]);
  const [assigningLocation, setAssigningLocation] = useState<{ [key: number]: string }>({});
  const [newFlightData, setNewFlightData] = useState({ pilotId: '', droneId: '', date: '', notes: '' });
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvImportData, setCsvImportData] = useState({ pilotId: '', droneId: '' });
  const [bulkImportPilot, setBulkImportPilot] = useState('');
  const [filters, setFilters] = useState({ droneId: droneIdFromUrl || '', locationId: locationIdFromUrl || '', startDate: '', endDate: '', });
  const [order, setOrder] = useState<Order>('desc');
  const [orderBy, setOrderBy] = useState<keyof SortableFlight>('flight_date');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [totalFlights, setTotalFlights] = useState(0);
  const [editingFlightId, setEditingFlightId] = useState<number | null>(null);
  const [dateFormat, setDateFormat] = useState('MM/DD/YYYY');
  const [timeFormat, setTimeFormat] = useState('HH:mm:ss');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
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

  const formatDateTime = (date: Date) => {
    const options: Intl.DateTimeFormatOptions = {
      year: dateFormat.includes('YYYY') ? 'numeric' : undefined,
      month: dateFormat.includes('MM') ? '2-digit' : undefined,
      day: dateFormat.includes('DD') ? '2-digit' : undefined,
      hour: timeFormat.includes('HH') || timeFormat.includes('h') ? '2-digit' : undefined,
      minute: timeFormat.includes('mm') ? '2-digit' : undefined,
      second: timeFormat.includes('ss') ? '2-digit' : undefined,
      hour12: timeFormat.includes('a'),
    };
    return new Intl.DateTimeFormat(undefined, options).format(date);
  };

  const fetchFlights = useCallback(async () => {
    try {
      const skip = page * rowsPerPage;
      const limit = rowsPerPage;
      const response = await getFlights(
        filters.locationId ? parseInt(filters.locationId) : undefined,
        filters.droneId ? parseInt(filters.droneId) : undefined,
        filters.startDate,
        filters.endDate,
        skip,
        limit
      );
      setFlights(response.data.flights || []);
      setTotalFlights(response.data.total_flights || 0);
    } catch (error) {
      console.error('Error fetching flights:', error);
    }
  }, [filters, page, rowsPerPage]);

  const fetchInitialData = useCallback(async () => {
    try {
      const [pilotsRes, dronesRes, locationsRes] = await Promise.all([getPilots(), getDrones(), getFlightLocations()]);
      setPilots(pilotsRes.data);
      setDrones(dronesRes.data);
      setFlightLocations(locationsRes.data);
    } catch (error) {
      console.error('Error fetching initial data:', error);
    }
  }, []);

  useEffect(() => { fetchInitialData(); }, [fetchInitialData]);
  useEffect(() => { fetchFlights(); }, [filters, fetchFlights, page, rowsPerPage]);

  const handleRequestSort = (property: keyof SortableFlight) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const sortedFlights = useMemo(() => {
    if (!flights) {
      return [];
    }
    const sortable: SortableFlight[] = flights.map(f => ({
      ...f,
      pilot_name: f.pilot?.name || 'N/A',
      drone_name: f.drone?.name || 'N/A',
      location_name: f.flight_location?.name || 'ZZZ',
      duration: f.duration || 0,
      flight_date: f.flight_data.length > 0 ? f.flight_data[0].timestamp : f.flight_date,
    }));
    return stableSort(sortable, getComparator(order, orderBy));
  }, [flights, order, orderBy]);

  const handleFilterInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value as string }));
  };

  const handleFilterSelectChange = (e: { target: { name: string; value: unknown } }) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value as string }));
  };

  const handleCreateFlight = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFlightData.pilotId || !newFlightData.droneId || !newFlightData.date) return;
    await createFlight(parseInt(newFlightData.pilotId), parseInt(newFlightData.droneId), newFlightData.date, newFlightData.notes);
    setNewFlightData({ pilotId: '', droneId: '', date: '', notes: '' });
    fetchFlights();
  };

  const handleUploadCsv = async () => {
    if (!csvFile || !csvImportData.pilotId) return alert('Please select a pilot and a CSV file.');
    const formData = new FormData();
    formData.append('file', csvFile);
    formData.append('pilot_id', csvImportData.pilotId);
    if (csvImportData.droneId) formData.append('drone_id', csvImportData.droneId);
    await axios.post('/api/flights/upload_csv', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    fetchFlights();
  };

  const handleBulkImport = async () => {
    if (!bulkImportPilot) return alert('Please select a pilot for bulk import.');
    const formData = new FormData();
    formData.append('pilot_id', bulkImportPilot);
    await axios.post('/api/flights/import_all_csvs', formData);
    fetchFlights();
    fetchInitialData(); // Refresh locations
  };

  const handleAssignLocation = async (flightId: number) => {
    const locationId = assigningLocation[flightId];
    if (!locationId) return alert('Please select a location.');
    await assignFlightLocation(flightId, parseInt(locationId));
    fetchFlights();
  };

  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleSetFlightValidity = async (flightId: number, isValid: boolean, notes?: string) => {
    try {
      await setFlightValidity(flightId, isValid, notes);
      fetchFlights();
    } catch (error) {
      console.error(`Error setting flight validity for flight ${flightId}:`, error);
    }
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      <Typography variant="h4" gutterBottom>Flights Management</Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box component="form" onSubmit={handleCreateFlight}>
              <Typography variant="h6">Add New Flight (Manual)</Typography>
              <FormControl fullWidth margin="normal"><InputLabel>Pilot</InputLabel><Select name="pilotId" value={newFlightData.pilotId} onChange={(e) => setNewFlightData(p => ({...p, pilotId: e.target.value}))} label="Pilot">{pilots.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}</Select></FormControl>
              <FormControl fullWidth margin="normal"><InputLabel>Drone</InputLabel><Select name="droneId" value={newFlightData.droneId} onChange={(e) => setNewFlightData(p => ({...p, droneId: e.target.value}))} label="Drone">{drones.map(d => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}</Select></FormControl>
              <TextField type="date" value={newFlightData.date} onChange={(e) => setNewFlightData(p => ({...p, date: e.target.value}))} fullWidth margin="normal" InputLabelProps={{ shrink: true }} />
              <TextField label="Notes" value={newFlightData.notes} onChange={(e) => setNewFlightData(p => ({...p, notes: e.target.value}))} multiline rows={2} fullWidth margin="normal" />
              <Button type="submit" variant="contained">Add Flight</Button>
            </Box>
            <Box>
              <Typography variant="h6">Upload Single CSV Log</Typography>
              <FormControl fullWidth margin="normal"><InputLabel>Pilot</InputLabel><Select value={csvImportData.pilotId} onChange={(e) => setCsvImportData(p => ({...p, pilotId: e.target.value}))} label="Pilot">{pilots.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}</Select></FormControl>
              <FormControl fullWidth margin="normal"><InputLabel>Drone (Optional)</InputLabel><Select value={csvImportData.droneId} onChange={(e) => setCsvImportData(p => ({...p, droneId: e.target.value}))} label="Drone (Optional)">{drones.map(d => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}</Select></FormControl>
              <Button component="label" variant="outlined" startIcon={<MdUploadFile />} sx={{ mt: 1, mb: 1 }}>{csvFile ? csvFile.name : 'Select CSV'}<input type="file" hidden accept=".csv" onChange={(e) => setCsvFile(e.target.files ? e.target.files[0] : null)} /></Button>
              <Button onClick={handleUploadCsv} variant="contained" disabled={!csvFile || !csvImportData.pilotId}>Upload</Button>
            </Box>
            <Box>
              <Typography variant="h6">Bulk Import CSVs</Typography>
              <FormControl fullWidth margin="normal"><InputLabel>Pilot</InputLabel><Select value={bulkImportPilot} onChange={(e) => setBulkImportPilot(e.target.value)} label="Pilot">{pilots.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}</Select></FormControl>
              <Button onClick={handleBulkImport} variant="contained" disabled={!bulkImportPilot}>Import All</Button>
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6">Filter Flights</Typography>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={6}><FormControl fullWidth><InputLabel>Drone</InputLabel><Select name="droneId" value={drones.length > 0 ? filters.droneId : ''} onChange={handleFilterSelectChange} label="Drone"><MenuItem value="">All Drones</MenuItem>{drones.map(d => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}</Select></FormControl></Grid>
              <Grid item xs={12} sm={6}><FormControl fullWidth><InputLabel>Location</InputLabel><Select name="locationId" value={filters.locationId} onChange={handleFilterSelectChange} label="Location"><MenuItem value="">All Locations</MenuItem>{flightLocations.map(l => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}</Select></FormControl></Grid>
              <Grid item xs={12} sm={6}><TextField name="startDate" label="Start Date" type="date" value={filters.startDate} onChange={handleFilterInputChange} fullWidth InputLabelProps={{ shrink: true }} /></Grid>
              <Grid item xs={12} sm={6}><TextField name="endDate" label="End Date" type="date" value={filters.endDate} onChange={handleFilterInputChange} fullWidth InputLabelProps={{ shrink: true }} /></Grid>
            </Grid>
          </Paper>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">Existing Flights</Typography>
            <TableContainer>
              <Table stickyHeader size="small">
                <TableHead><TableRow>
                  <TableCell sortDirection={orderBy === 'flight_date' ? order : false}><Tooltip title={orderBy === 'flight_date' ? `Sort by date ${order === 'asc' ? 'descending' : 'ascending'}` : 'Sort by date'}><TableSortLabel active={orderBy === 'flight_date'} direction={orderBy === 'flight_date' ? order : 'asc'} onClick={() => handleRequestSort('flight_date')}>Date</TableSortLabel></Tooltip></TableCell>
                  <TableCell sortDirection={orderBy === 'pilot_name' ? order : false}><Tooltip title={orderBy === 'pilot_name' ? `Sort by pilot name ${order === 'asc' ? 'descending' : 'ascending'}` : 'Sort by pilot name'}><TableSortLabel active={orderBy === 'pilot_name'} direction={orderBy === 'pilot_name' ? order : 'asc'} onClick={() => handleRequestSort('pilot_name')}>Pilot</TableSortLabel></Tooltip></TableCell>
                  <TableCell sortDirection={orderBy === 'drone_name' ? order : false}><Tooltip title={orderBy === 'drone_name' ? `Sort by drone name ${order === 'asc' ? 'descending' : 'ascending'}` : 'Sort by drone name'}><TableSortLabel active={orderBy === 'drone_name'} direction={orderBy === 'drone_name' ? order : 'asc'} onClick={() => handleRequestSort('drone_name')}>Drone</TableSortLabel></Tooltip></TableCell>
                  <TableCell sortDirection={orderBy === 'duration' ? order : false}><Tooltip title={orderBy === 'duration' ? `Sort by duration ${order === 'asc' ? 'descending' : 'ascending'}` : 'Sort by duration'}><TableSortLabel active={orderBy === 'duration'} direction={orderBy === 'duration' ? order : 'asc'} onClick={() => handleRequestSort('duration')}>Duration</TableSortLabel></Tooltip></TableCell>
                  <TableCell sortDirection={orderBy === 'location_name' ? order : false}><Tooltip title={orderBy === 'location_name' ? `Sort by location name ${order === 'asc' ? 'descending' : 'ascending'}` : 'Sort by location name'}><TableSortLabel active={orderBy === 'location_name'} direction={orderBy === 'location_name' ? order : 'asc'} onClick={() => handleRequestSort('location_name')}>Location</TableSortLabel></Tooltip></TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow></TableHead>
                <TableBody>
                  {sortedFlights.map((flight) => (
                    <TableRow key={flight.id} hover sx={{ backgroundColor: flight.is_valid ? 'inherit' : '#ffebee' }}>
                      <TableCell><Tooltip title={flight.flight_date}><RouterLink to={`/flights/${flight.id}`}>{flight.flight_data.length > 0 ? formatDateTime(new Date(flight.flight_data[0].timestamp)) : new Date(flight.flight_date).toLocaleDateString()}</RouterLink></Tooltip></TableCell>
                      <TableCell>{flight.pilot_name}</TableCell>
                      <TableCell>{flight.drone_name}</TableCell>
                      <TableCell>{formatDuration(flight.duration)}</TableCell>
                      <TableCell>
                        {editingFlightId === flight.id ? (
                          <>
                            <FormControl size="small" sx={{minWidth: 150}}>
                              <InputLabel>Location</InputLabel>
                              <Select
                                label="Location"
                                value={assigningLocation[flight.id] || ''}
                                onChange={(e) => {
                                  setAssigningLocation(prev => ({ ...prev, [flight.id]: e.target.value as string }));
                                }}
                              >
                                {flightLocations.map(l => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
                              </Select>
                            </FormControl>
                            <Tooltip title="Save">
                              <IconButton size="small" onClick={() => {
                                handleAssignLocation(flight.id);
                                setEditingFlightId(null);
                              }}>
                                <MdCheckCircle />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Cancel">
                              <IconButton size="small" onClick={() => setEditingFlightId(null)}>
                                <MdCancel />
                              </IconButton>
                            </Tooltip>
                          </>
                        ) : (
                          <>
                            <span style={{ marginRight: '8px' }}>{flight.flight_location?.name || 'N/A'}</span>
                            <Tooltip title="Edit Location">
                              <IconButton size="small" onClick={() => {
                                setEditingFlightId(flight.id);
                                const location = flight.flight_location;
                                if (location) {
                                  setAssigningLocation(prev => ({ ...prev, [flight.id]: String(location.id) }));
                                }
                              }}>
                                <MdEdit />
                              </IconButton>
                            </Tooltip>
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        {flight.is_valid ? (
                          <Tooltip title="Mark as Invalid">
                            <IconButton size="small" onClick={() => handleSetFlightValidity(flight.id, false, prompt('Enter reason for invalidation:') ?? undefined)}>
                              <MdBlock />
                            </IconButton>
                          </Tooltip>
                        ) : (
                          <Tooltip title={`Mark as Valid (Notes: ${flight.invalidation_notes || 'None'})`}>
                            <IconButton size="small" onClick={() => handleSetFlightValidity(flight.id, true)}>
                              <MdCheckCircle />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title="Delete Flight"><IconButton size="small" onClick={() => deleteFlight(flight.id).then(fetchFlights)}><MdDelete /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              rowsPerPageOptions={[10, 25, 50, 100]}
              component="div"
              count={totalFlights}
              rowsPerPage={rowsPerPage}
              page={page}
              onPageChange={handleChangePage}
              onRowsPerPageChange={handleChangeRowsPerPage}
            />
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

export default Flights;
Flights;