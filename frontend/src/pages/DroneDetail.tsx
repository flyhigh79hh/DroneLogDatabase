import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { getDrones, updateDrone, getFlights, getBatteryPackUsage, getDroneImages, uploadDroneImage, deleteImage } from '../services/api';
import {
  Box,
  Button,
  Typography,
  Paper,
  Grid,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Link,
  TableSortLabel,
  Divider,
  IconButton,
  Tooltip,
  Modal
} from '@mui/material';
import { IoArrowBack as ArrowBackIcon } from 'react-icons/io5';
import { MdDelete, MdUploadFile } from 'react-icons/md';

// Interfaces
interface Drone { id: number; name: string; notes?: string; images?: DroneImage[] }
interface DroneImage { id: number; drone_id: number; file_path: string; description?: string; upload_date: string; }
interface FlightLocation { id: number; name: string; latitude: number; longitude: number; notes?: string; }
interface FlightData { id?: number; timestamp: string; latitude?: number; longitude?: number; altitude?: number; speed?: number; rx_bt?: number; rssi?: number; rqly?: number; distance_from_start?: number; }
interface Flight { id: number; pilot_id: number; drone_id: number; flight_date: string; notes?: string; csv_log_path?: string; flight_location?: FlightLocation; flight_data?: FlightData[]; duration?: number; }
interface BatteryPackUsage { battery_pack: { id: number; name: string; number: string; }; flight_count: number; total_duration_seconds: number; }

// Enriched interfaces for sorting
interface SortableFlight extends Flight {
  durationSeconds: number;
  maxSpeed: number;
  maxAltitude: number;
  locationName: string;
}
interface SortableBatteryUsage extends BatteryPackUsage {
  packName: string;
}

// Sorting utilities
type Order = 'asc' | 'desc';
function descendingComparator<T>(a: T, b: T, orderBy: keyof T) {
  if (b[orderBy] < a[orderBy]) return -1;
  if (b[orderBy] > a[orderBy]) return 1;
  return 0;
}
function getComparator<T, Key extends keyof T>(order: Order, orderBy: Key): (a: T, b: T) => number {
  return order === 'desc' ? (a, b) => descendingComparator(a, b, orderBy) : (a, b) => -descendingComparator(a, b, orderBy);
}
function stableSort<T>(array: readonly T[], comparator: (a: T, b: T) => number) {
  const stabilizedThis = array.map((el, index) => [el, index] as [T, number]);
  stabilizedThis.sort((a, b) => { const order = comparator(a[0], b[0]); if (order !== 0) return order; return a[1] - b[1]; });
  return stabilizedThis.map((el) => el[0]);
}

const formatDuration = (seconds: number) => new Date(seconds * 1000).toISOString().substr(11, 8);

function DroneDetail() {
  const { id } = useParams<{ id: string }>();
  const droneId = parseInt(id || '');
  const [drone, setDrone] = useState<Drone | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [editingNotes, setEditingNotes] = useState(false);
  const [newNotes, setNewNotes] = useState('');
  const [batteryPackUsage, setBatteryPackUsage] = useState<BatteryPackUsage[]>([]);
  const [images, setImages] = useState<DroneImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imageDescription, setImageDescription] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedImageForModal, setSelectedImageForModal] = useState<string>('');

  const [flightOrder, setFlightOrder] = useState<Order>('desc');
  const [flightOrderBy, setFlightOrderBy] = useState<keyof SortableFlight>('flight_date');
  const [batteryOrder, setBatteryOrder] = useState<Order>('asc');
  const [batteryOrderBy, setBatteryOrderBy] = useState<keyof SortableBatteryUsage>('packName');

  const fetchDroneDetails = useCallback(async () => {
    const response = await getDrones();
    const foundDrone = response.data.find((d: Drone) => d.id === droneId);
    if (foundDrone) {
      setDrone(foundDrone);
      setNewNotes(foundDrone.notes || '');
    }
  }, [droneId]);

  const fetchDroneImages = useCallback(async () => {
    if (droneId) {
      const response = await getDroneImages(droneId);
      setImages(response.data);
    }
  }, [droneId]);

  const fetchDroneFlights = useCallback(async () => {
    const response = await getFlights(undefined, droneId, undefined, undefined, 0, 1000);
    setFlights(response.data.flights);
  }, [droneId]);

  const fetchBatteryPackUsage = useCallback(async () => {
    const response = await getBatteryPackUsage(droneId);
    setBatteryPackUsage(response.data);
  }, [droneId]);

  useEffect(() => {
    if (droneId) {
      fetchDroneDetails();
      fetchDroneFlights();
      fetchBatteryPackUsage();
      fetchDroneImages();
    }
  }, [droneId, fetchDroneDetails, fetchDroneFlights, fetchBatteryPackUsage, fetchDroneImages]);

  const handleSaveNotes = async () => {
    if (!drone) return;
    await updateDrone(drone.id, drone.name, newNotes);
    setEditingNotes(false);
    fetchDroneDetails();
  };

  const handleImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files ? e.target.files[0] : null;
    setSelectedImage(file);
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
  };

  const handleImageUpload = async () => {
    if (!selectedImage || !droneId) {
      alert('Please select an image to upload.');
      return;
    }
    setIsUploading(true);
    try {
      await uploadDroneImage(droneId, selectedImage, imageDescription);
      setSelectedImage(null);
      setImageDescription('');
      setImagePreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      fetchDroneImages();
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleImageDelete = async (imageId: number) => {
    if (!window.confirm('Are you sure you want to delete this image?')) {
      return;
    }
    try {
      await deleteImage('drone', imageId);
      fetchDroneImages();
    } catch (error) {
      console.error('Error deleting image:', error);
      alert('Failed to delete image.');
    }
  };

  const handleFlightRequestSort = (property: keyof SortableFlight) => {
    const isAsc = flightOrderBy === property && flightOrder === 'asc';
    setFlightOrder(isAsc ? 'desc' : 'asc');
    setFlightOrderBy(property);
  };

  const handleBatteryRequestSort = (property: keyof SortableBatteryUsage) => {
    const isAsc = batteryOrderBy === property && batteryOrder === 'asc';
    setBatteryOrder(isAsc ? 'desc' : 'asc');
    setBatteryOrderBy(property);
  };

  const handleOpenModal = (imageUrl: string) => {
    setSelectedImageForModal(imageUrl);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedImageForModal('');
  };

  const sortedFlights = useMemo(() => {
    const enrichedFlights: SortableFlight[] = flights.map(flight => {
      let maxSpeed = 0, maxAltitude = 0;
      if (flight.flight_data && flight.flight_data.length > 0) {
        flight.flight_data.forEach(dp => {
          if (dp.speed && dp.speed > maxSpeed) maxSpeed = dp.speed;
          if (dp.altitude && dp.altitude > maxAltitude) maxAltitude = dp.altitude;
        });
      }
      const durationSeconds = flight.duration || 0;
      return { ...flight, durationSeconds, maxSpeed, maxAltitude, locationName: flight.flight_location?.name || '' };
    });
    return stableSort(enrichedFlights, getComparator(flightOrder, flightOrderBy));
  }, [flights, flightOrder, flightOrderBy]);

  const sortedBatteryUsage = useMemo(() => {
    const enrichedUsage: SortableBatteryUsage[] = batteryPackUsage.map(u => ({ ...u, packName: `${u.battery_pack.number} - ${u.battery_pack.name}` }));
    return stableSort(enrichedUsage, getComparator(batteryOrder, batteryOrderBy));
  }, [batteryPackUsage, batteryOrder, batteryOrderBy]);

  if (!drone) return <CircularProgress />;

  return (
    <Box>
      <Button component={RouterLink} to="/drones" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>Back to Drones</Button>
      <Typography variant="h4" gutterBottom>Drone Details: {drone.name}</Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">Notes</Typography>
            {editingNotes ? (
              <Box>
                <TextField value={newNotes} onChange={(e) => setNewNotes(e.target.value)} multiline rows={4} fullWidth variant="outlined" sx={{ my: 1 }} />
                <Button onClick={handleSaveNotes} variant="contained">Save</Button>
                <Button onClick={() => setEditingNotes(false)} sx={{ ml: 1 }}>Cancel</Button>
              </Box>
            ) : (
              <Box>
                <Typography variant="body1" sx={{ my: 1, whiteSpace: 'pre-wrap' }}>{drone.notes || 'No notes.'}</Typography>
                <Button onClick={() => setEditingNotes(true)}>Edit Notes</Button>
              </Box>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">Images</Typography>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              {images.length > 0 ? (
                images.map(image => (
                  <Grid item key={image.id}>
                    <Paper sx={{ p: 1, position: 'relative' }}>
                      <img
                        src={`http://localhost:8000/images/drone/${image.id}`}
                        alt={image.description || 'Drone Image'}
                        style={{ width: '150px', height: '150px', objectFit: 'cover', cursor: 'pointer' }}
                        onClick={() => handleOpenModal(`http://localhost:8000/images/drone/${image.id}`)}
                      />
                      <Tooltip title="Delete Image">
                        <IconButton
                          size="small"
                          sx={{ position: 'absolute', top: 0, right: 0, bgcolor: 'rgba(255,255,255,0.7)' }}
                          onClick={() => handleImageDelete(image.id)}
                        >
                          <MdDelete fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {image.description && <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>{image.description}</Typography>}
                    </Paper>
                  </Grid>
                )))
                : (
                  <Grid item xs={12}>
                    <Typography>No images uploaded for this drone.</Typography>
                  </Grid>
                )
              }
            </Grid>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle1">Upload New Image</Typography>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', mt: 1 }}>
                <Box sx={{ mr: 2 }}>
                  <input
                    accept="image/*"
                    style={{ display: 'none' }}
                    id={`upload-button-${droneId}`}
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageSelected}
                  />
                  <label htmlFor={`upload-button-${droneId}`}>
                    <Button variant="outlined" component="span" startIcon={<MdUploadFile />}>
                      Select Image
                    </Button>
                  </label>
                </Box>
                {imagePreview && (
                  <Box sx={{ mr: 2 }}>
                    <img src={imagePreview} alt="Preview" style={{ width: '100px', height: '100px', objectFit: 'cover' }} />
                  </Box>
                )}
                <TextField
                  label="Description (Optional)"
                  value={imageDescription}
                  onChange={(e) => setImageDescription(e.target.value)}
                  size="small"
                  sx={{ flexGrow: 1, mr: 2 }}
                />
                <Button
                  variant="contained"
                  onClick={handleImageUpload}
                  disabled={!selectedImage || isUploading}
                >
                  {isUploading ? <CircularProgress size={24} /> : 'Upload'}
                </Button>
              </Box>
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Associated Flights</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead><TableRow>
                  <TableCell><TableSortLabel active={flightOrderBy === 'flight_date'} direction={flightOrder} onClick={() => handleFlightRequestSort('flight_date')}>Date</TableSortLabel></TableCell>
                  <TableCell><TableSortLabel active={flightOrderBy === 'locationName'} direction={flightOrder} onClick={() => handleFlightRequestSort('locationName')}>Location</TableSortLabel></TableCell>
                  <TableCell><TableSortLabel active={flightOrderBy === 'durationSeconds'} direction={flightOrder} onClick={() => handleFlightRequestSort('durationSeconds')}>Duration</TableSortLabel></TableCell>
                  <TableCell><TableSortLabel active={flightOrderBy === 'maxSpeed'} direction={flightOrder} onClick={() => handleFlightRequestSort('maxSpeed')}>Max Speed</TableSortLabel></TableCell>
                  <TableCell><TableSortLabel active={flightOrderBy === 'maxAltitude'} direction={flightOrder} onClick={() => handleFlightRequestSort('maxAltitude')}>Max Alt</TableSortLabel></TableCell>
                </TableRow></TableHead>
                <TableBody>{sortedFlights.map((flight) => (
                  <TableRow key={flight.id} hover>
                    <TableCell><Link component={RouterLink} to={`/flights/${flight.id}`}>{new Date(flight.flight_date).toLocaleDateString()}</Link></TableCell>
                    <TableCell>{flight.locationName || 'N/A'}</TableCell>
                    <TableCell>{formatDuration(flight.durationSeconds)}</TableCell>
                    <TableCell>{flight.maxSpeed.toFixed(1)} km/h</TableCell>
                    <TableCell>{flight.maxAltitude.toFixed(1)} m</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Battery Pack Usage</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead><TableRow>
                  <TableCell><TableSortLabel active={batteryOrderBy === 'packName'} direction={batteryOrder} onClick={() => handleBatteryRequestSort('packName')}>Pack</TableSortLabel></TableCell>
                  <TableCell><TableSortLabel active={batteryOrderBy === 'flight_count'} direction={batteryOrder} onClick={() => handleBatteryRequestSort('flight_count')}>Flights</TableSortLabel></TableCell>
                  <TableCell><TableSortLabel active={batteryOrderBy === 'total_duration_seconds'} direction={batteryOrder} onClick={() => handleBatteryRequestSort('total_duration_seconds')}>Total Time</TableSortLabel></TableCell>
                </TableRow></TableHead>
                <TableBody>{sortedBatteryUsage.map(usage => (
                  <TableRow key={usage.battery_pack.id} hover>
                    <TableCell><Link component={RouterLink} to={`/batteries/${usage.battery_pack.id}`}>{usage.packName}</Link></TableCell>
                    <TableCell>{usage.flight_count}</TableCell>
                    <TableCell>{formatDuration(usage.total_duration_seconds)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        aria-labelledby="image-modal-title"
        aria-describedby="image-modal-description"
      >
        <Box sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          bgcolor: 'background.paper',
          boxShadow: 24,
          p: 4,
        }}>
          <img src={selectedImageForModal} alt="Enlarged drone" style={{ maxWidth: '90vw', maxHeight: '90vh' }} />
        </Box>
      </Modal>
    </Box>
  );
}

export default DroneDetail;
