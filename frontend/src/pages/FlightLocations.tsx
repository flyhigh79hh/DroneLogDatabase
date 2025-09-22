import { useState, useEffect, useRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { getFlightLocations, updateFlightLocation, deleteFlightLocation, getLocationStatistics, setFlightLocationValidity, getSetting, uploadLocationImage, getLocationImages, deleteImage } from '../services/api';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  IconButton,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  Grid,
  Divider,
  CircularProgress,
  Modal
} from '@mui/material';
import { MdEdit, MdDelete, MdSave, MdCancel, MdExpandMore, MdBlock, MdCheckCircle, MdUploadFile } from 'react-icons/md';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Leaflet icon fix
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

// Interfaces
interface LocationImage {
  id: number;
  location_id: number;
  file_path: string;
  description?: string;
  upload_date: string; // Assuming ISO string from backend
}

interface FlightLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  notes?: string;
  is_valid: boolean;
  invalidation_notes?: string;
  flight_count: number;
  images?: LocationImage[]; // Add this line
}

interface LocationStatistics { total_flights: number; total_flight_duration_seconds: number; total_distance_meters: number; flights_per_drone: Array<{ drone_id: number; drone_name: string; count: number }>; first_flight_date?: string; last_flight_date?: string; }

// New component to handle map logic and invalidateSize
function MapComponent({ locations, showDipulMapLink }: { locations: FlightLocation[], showDipulMapLink: boolean }) {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 100); // Small delay to allow DOM to settle

    return () => {
      clearTimeout(timer);
    };
  }, [map]); // Depend on map instance

  return (
    <>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {locations.map(location => (
        <Marker key={location.id} position={[location.latitude, location.longitude]}>
          <Popup>
            <Box>
              <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', mb: 1 }}>
                {location.name}
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Flights: {location.flight_count}
              </Typography>
              <RouterLink to={`/flights?location_id=${location.id}`}>View Flights</RouterLink>
              {showDipulMapLink && (
                <>
                  <br />
                  <a href={`https://maptool-dipul.dfs.de/geozones/@${location.longitude},${location.latitude}?zoom=15.0`} target="_blank" rel="noopener noreferrer">
                    View on Dipul Map
                  </a>
                </>
              )}
            </Box>
          </Popup>
        </Marker>
      ))}
    </>
  );
}


function FlightLocations() {
  const [locations, setLocations] = useState<FlightLocation[]>([]);
  const [editingLocationId, setEditingLocationId] = useState<number | null>(null);
  const [editFormData, setEditFormData] = useState({ name: '', notes: '' });
  const [locationStatistics, setLocationStatistics] = useState<{ [key: number]: LocationStatistics }>({});
  const [expanded, setExpanded] = useState<number | false>(false);
  const [loadingStats, setLoadingStats] = useState<number | null>(null);
  const [showDipulMapLink, setShowDipulMapLink] = useState(true);

  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imageDescription, setImageDescription] = useState<string>('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedImageForModal, setSelectedImageForModal] = useState<string>('');

  useEffect(() => {
    fetchLocations();
    const fetchSettings = async () => {
      try {
        const response = await getSetting('show_dipul_map_link');
        setShowDipulMapLink(response.data.value === 'true');
      } catch (error) {
        console.error("Error fetching settings:", error);
      }
    };
    fetchSettings();
  }, []);

  const fetchLocations = async () => {
    const response = await getFlightLocations(); // include_invalid: false by default
    setLocations(response.data);
  };

  const handleAccordionChange = (panelId: number) => (_: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panelId : false);
    if (isExpanded && !locationStatistics[panelId]) {
      fetchStatistics(panelId);
    }
  };

  const fetchStatistics = async (locationId: number) => {
    setLoadingStats(locationId);
    try {
      const [statsResponse, imagesResponse] = await Promise.all([
        getLocationStatistics(locationId),
        getLocationImages(locationId) // Fetch images
      ]);
      setLocationStatistics(prev => ({ ...prev, [locationId]: statsResponse.data }));
      // Update the specific location in the 'locations' state with its images
      setLocations(prevLocations => prevLocations.map(loc =>
        loc.id === locationId ? { ...loc, images: imagesResponse.data } : loc
      ));
    } catch (error) {
      console.error(`Error fetching data for location ${locationId}:`, error);
    }
    setLoadingStats(null);
  };

  const handleEditClick = (location: FlightLocation) => {
    setEditingLocationId(location.id);
    setEditFormData({ name: location.name, notes: location.notes || '' });
  };

  const handleCancelEdit = () => {
    setEditingLocationId(null);
  };

  const handleSaveEdit = async (locationId: number) => {
    const currentLoc = locations.find(loc => loc.id === locationId);
    if (!currentLoc) return;
    await updateFlightLocation(locationId, editFormData.name, currentLoc.latitude, currentLoc.longitude, editFormData.notes);
    setEditingLocationId(null);
    fetchLocations();
  };

  const handleDeleteLocation = async (locationId: number) => {
    if (window.confirm('Are you sure?')) {
      await deleteFlightLocation(locationId);
      fetchLocations();
    }
  };

  const formatDuration = (seconds: number) => new Date(seconds * 1000).toISOString().substr(11, 8);

  const handleSetFlightLocationValidity = async (locationId: number, isValid: boolean, notes?: string) => {
    try {
      await setFlightLocationValidity(locationId, isValid, notes);
      fetchLocations();
    } catch (error) {
      console.error(`Error setting flight location validity for location ${locationId}:`, error);
    }
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

  const handleImageUpload = async (locationId: number) => {
    if (!selectedImage) {
      alert('Please select an image to upload.');
      return;
    }
    setIsUploading(true);
    try {
      await uploadLocationImage(locationId, selectedImage, imageDescription);
      setSelectedImage(null);
      setImageDescription('');
      setImagePreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      // Re-fetch statistics to update images
      fetchStatistics(locationId);
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleImageDelete = async (imageId: number, locationId: number) => {
    if (!window.confirm('Are you sure you want to delete this image?')) {
      return;
    }
    try {
      await deleteImage('location', imageId);
      // Re-fetch statistics to update images
      fetchStatistics(locationId);
    } catch (error) {
      console.error('Error deleting image:', error);
      alert('Failed to delete image.');
    }
  };

  const handleOpenModal = (imageUrl: string) => {
    setSelectedImageForModal(imageUrl);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedImageForModal('');
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Flight Locations</Typography>
      <Paper sx={{ height: '50vh', width: '100%', mb: 3 }}>
        <MapContainer center={[51.505, -0.09]} zoom={3} style={{ height: '100%', width: '100%' }}>
          <MapComponent locations={locations} showDipulMapLink={showDipulMapLink} />
        </MapContainer>
      </Paper>
      {locations.length > 0 ? (
        locations.map((location) => (
          <Accordion key={location.id} expanded={expanded === location.id} onChange={handleAccordionChange(location.id)} sx={{ backgroundColor: location.is_valid ? 'inherit' : '#ffebee' }}>
            <AccordionSummary expandIcon={<MdExpandMore />}>
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                <Typography sx={{ flexGrow: 1, textDecoration: location.is_valid ? 'none' : 'line-through' }}>{location.name}</Typography>
                <Typography variant="body2" color="text.secondary">({location.latitude.toFixed(4)}, {location.longitude.toFixed(4)})</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {editingLocationId === location.id ? (
                <Paper sx={{ p: 2, mb: 2 }}>
                  <Typography variant="h6">Edit Location</Typography>
                  <TextField label="Location Name" value={editFormData.name} onChange={(e) => setEditFormData({...editFormData, name: e.target.value})} fullWidth margin="normal" />
                  <TextField label="Notes" value={editFormData.notes} onChange={(e) => setEditFormData({...editFormData, notes: e.target.value})} multiline rows={3} fullWidth margin="normal" />
                  <Button startIcon={<MdSave />} onClick={() => handleSaveEdit(location.id)} variant="contained">Save</Button>
                  <Button startIcon={<MdCancel />} onClick={handleCancelEdit} sx={{ ml: 1 }}>Cancel</Button>
                </Paper>
              ) : (
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="body1">{location.notes || 'No notes for this location.'}</Typography>
                    <Box>
                      {location.is_valid ? (
                        <Tooltip title="Mark as Invalid">
                          <IconButton onClick={() => handleSetFlightLocationValidity(location.id, false, prompt('Enter reason for invalidation:') ?? undefined)}>
                            <MdBlock />
                          </IconButton>
                        </Tooltip>
                      ) : (
                        <Tooltip title={`Mark as Valid (Notes: ${location.invalidation_notes || 'None'})`}>
                          <IconButton onClick={() => handleSetFlightLocationValidity(location.id, true)}>
                            <MdCheckCircle />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Edit"><IconButton onClick={() => handleEditClick(location)}><MdEdit /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton onClick={() => handleDeleteLocation(location.id)}><MdDelete /></IconButton></Tooltip>
                    </Box>
                  </Box>
                  <Divider />
                  <Typography variant="h6" sx={{ mt: 2 }}>Statistics</Typography>
                  {loadingStats === location.id ? <CircularProgress sx={{my: 2}} /> : locationStatistics[location.id] ? (
                    <Grid container spacing={2} sx={{ mt: 1 }}>
                      <Grid item xs={12} sm={6} md={3}><Typography><strong>Total Flights:</strong> <RouterLink to={`/flights?location_id=${location.id}`}>{locationStatistics[location.id].total_flights}</RouterLink></Typography></Grid>
                      <Grid item xs={12} sm={6} md={3}><Typography><strong>Total Time:</strong> {formatDuration(locationStatistics[location.id].total_flight_duration_seconds)}</Typography></Grid>
                      <Grid item xs={12} sm={6} md={3}><Typography><strong>Total Distance:</strong> {(locationStatistics[location.id].total_distance_meters / 1000).toFixed(2)} km</Typography></Grid>
                      <Grid item xs={12} sm={6} md={3}><Typography><strong>First Flight:</strong> {locationStatistics[location.id].first_flight_date ? new Date(locationStatistics[location.id].first_flight_date!).toLocaleDateString() : 'N/A'}</Typography></Grid>
                      <Grid item xs={12} sm={6} md={3}><Typography><strong>Last Flight:</strong> {locationStatistics[location.id].last_flight_date ? new Date(locationStatistics[location.id].last_flight_date!).toLocaleDateString() : 'N/A'}</Typography></Grid>
                      <Grid item xs={12} md={6}>
                        <Typography variant="subtitle1">Flights per Drone:</Typography>
                        <List dense>
                          {locationStatistics[location.id].flights_per_drone.length > 0 ? (
                            locationStatistics[location.id].flights_per_drone.map((item, idx) => (
                              <ListItem key={idx}><ListItemText primary={<RouterLink to={`/flights?location_id=${location.id}&drone_id=${item.drone_id}`}>{item.drone_name}: {item.count}</RouterLink>} /></ListItem>
                            ))
                          ) : <ListItem><ListItemText primary="No drone data." /></ListItem>}
                        </List>
                      </Grid>
                    </Grid>
                  ) : <Typography>No statistics available.</Typography>}
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="h6" sx={{ mt: 2 }}>Images</Typography>
                  <Grid container spacing={2} sx={{ mt: 1 }}>
                    {location.images && location.images.length > 0 ? (
                      location.images.map(image => (
                        <Grid item key={image.id}>
                          <Paper sx={{ p: 1, position: 'relative' }}>
                            <img
                              src={`http://localhost:8000/images/location/${image.id}`}
                              alt={image.description || 'Location Image'}
                              style={{ width: '100px', height: '100px', objectFit: 'cover', cursor: 'pointer' }}
                              onClick={() => handleOpenModal(`http://localhost:8000/images/location/${image.id}`)}
                            />
                            <Tooltip title="Delete Image">
                              <IconButton
                                size="small"
                                sx={{ position: 'absolute', top: 0, right: 0, bgcolor: 'rgba(255,255,255,0.7)' }}
                                onClick={() => handleImageDelete(image.id, location.id)}
                              >
                                <MdDelete fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            {image.description && <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>{image.description}</Typography>}
                          </Paper>
                        </Grid>
                      ))
                    ) : (
                      <Grid item xs={12}><Typography>No images uploaded for this location.</Typography></Grid>
                    )}
                    <Grid item xs={12}>
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle1">Upload New Image</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', mt: 1 }}>
                          <Box sx={{ mr: 2 }}>
                            <input
                              accept="image/*"
                              style={{ display: 'none' }}
                              id={`upload-button-${location.id}`}
                              type="file"
                              ref={fileInputRef}
                              onChange={handleImageSelected}
                            />
                            <label htmlFor={`upload-button-${location.id}`}>
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
                            onClick={() => handleImageUpload(location.id)}
                            disabled={!selectedImage || isUploading}
                          >
                            {isUploading ? <CircularProgress size={24} /> : 'Upload'}
                          </Button>
                        </Box>
                      </Box>
                    </Grid>
                  </Grid>
                </Box>
              )}
            </AccordionDetails>
          </Accordion>
        ))
      ) : (
        <Typography>No flight locations found. Add one to get started!</Typography>
      )}
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
          <img src={selectedImageForModal} alt="Enlarged location" style={{ maxWidth: '90vw', maxHeight: '90vh' }} />
        </Box>
      </Modal>
    </Box>
  );
}

export default FlightLocations;
