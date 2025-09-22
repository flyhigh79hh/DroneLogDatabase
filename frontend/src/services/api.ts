import axios from 'axios';

const API_BASE_URL = '/api'; // Replace with your backend URL if different

const api = axios.create({
  baseURL: API_BASE_URL,
});

export const getPilots = () => api.get('/pilots/');
export const createPilot = (name: string) => api.post('/pilots/', { name });
export const setAsDefaultPilot = (pilotId: number) => api.put(`/pilots/${pilotId}/set_default`);
export const updatePilot = (pilotId: number, name: string, is_default?: boolean) => api.put(`/pilots/${pilotId}`, { name, is_default });
export const deletePilot = (pilotId: number) => api.delete(`/pilots/${pilotId}`);

export const getDrones = () => api.get('/drones/');
export const createDrone = (name: string, notes?: string) => api.post('/drones/', { name, notes });
export const updateDrone = (droneId: number, name: string, notes?: string) => api.put(`/drones/${droneId}`, { name, notes });
export const deleteDrone = (droneId: number) => api.delete(`/drones/${droneId}`);
export const getBatteryPackUsage = (droneId: number) => api.get(`/drones/${droneId}/battery_pack_usage`);

export const getFlightLocations = () => api.get('/flight_locations/');
export const createFlightLocation = (name: string, latitude: number, longitude: number) => api.post('/flight_locations/', { name, latitude, longitude });
export const updateFlightLocation = (locationId: number, name: string, latitude: number, longitude: number, notes?: string) => api.put(`/flight_locations/${locationId}`, { name, latitude, longitude, notes });
export const updateFlightLocationAltitudeOffset = (locationId: number, altitudeOffset: number) => api.put(`/flight_locations/${locationId}/altitude_offset`, { altitude_offset: altitudeOffset });
export const deleteFlightLocation = (locationId: number) => api.delete(`/flight_locations/${locationId}`);
export const getLocationStatistics = (locationId: number) => api.get(`/flight_locations/${locationId}/statistics`);
export const setFlightLocationValidity = (locationId: number, is_valid: boolean, invalidation_notes?: string) => api.put(`/flight_locations/${locationId}/set_validity`, { is_valid, invalidation_notes });

export const getFlights = (locationId?: number, droneId?: number, startDate?: string, endDate?: string, skip?: number, limit?: number) => {
  const params: { [key: string]: string | number } = {};
  if (locationId) params.location_id = locationId;
  if (droneId) params.drone_id = droneId;
  if (startDate) params.start_date = startDate;
  if (endDate) params.end_date = endDate;
  if (skip !== undefined) params.skip = skip;
  if (limit !== undefined) params.limit = limit;

  return api.get('/flights/', {
    params: params,
  });
};
export const getFlightById = (flightId: number) => api.get(`/flights/${flightId}`);
export const createFlight = (pilot_id: number, drone_id: number, flight_date: string, notes?: string, battery_pack_ids?: number[]) => api.post('/flights/', { pilot_id, drone_id, flight_date, notes, battery_pack_ids });
export const updateFlight = (flightId: number, pilot_id: number, drone_id: number, flight_date: string, notes?: string, battery_pack_ids?: number[]) => api.put(`/flights/${flightId}`, { pilot_id, drone_id, flight_date, notes, battery_pack_ids });
export const assignFlightLocation = (flightId: number, locationId: number) => api.put(`/flights/${flightId}/assign_location/${locationId}`);

export const deleteFlight = (flightId: number) => api.delete(`/flights/${flightId}`);
export const getFlightGpx = (flightId: number) => api.get(`/flights/${flightId}/gpx`, { responseType: 'blob' });
export const getFlightKml = (flightId: number) => api.get(`/flights/${flightId}/kml`, { responseType: 'blob' });
export const setFlightValidity = (flightId: number, is_valid: boolean, invalidation_notes?: string) => api.put(`/flights/${flightId}/set_validity`, { is_valid, invalidation_notes });

export const getBatteryPacks = () => api.get('/battery_packs/');
export const getBatteryPackById = (batteryPackId: number) => api.get(`/battery_packs/${batteryPackId}`);
export const createBatteryPack = (number: string, name: string, purchase_date?: string, notes?: string, voltage_level?: string, capacity_mah?: number) => api.post('/battery_packs/', { number, name, purchase_date, notes, voltage_level, capacity_mah });
export const updateBatteryPack = (batteryPackId: number, number: string, name: string, purchase_date?: string, notes?: string, voltage_level?: string, capacity_mah?: number) => api.put(`/battery_packs/${batteryPackId}`, { number, name, purchase_date, notes, voltage_level, capacity_mah });
export const deleteBatteryPack = (batteryPackId: number) => api.delete(`/battery_packs/${batteryPackId}`);

export const exportDatabase = () => api.get('/export_db');
export const exportFullBackup = () => api.get('/admin/export_zip', { responseType: 'blob' });
export const importDatabase = (formData: FormData) => api.post('/import_db', formData, {
  headers: {
    'Content-Type': 'multipart/form-data',
  },
});
export const importFullBackup = (formData: FormData) => api.post('/admin/import_zip', formData, {
    headers: {
        'Content-Type': 'multipart/form-data',
    },
});

export const getDashboardStatistics = () => api.get('/statistics/');

export const getSetting = (key: string) => api.get(`/settings/${key}`);
export const updateSetting = (key: string, value: string) => api.post('/settings', { key, value });

export const uploadLocationImage = (locationId: number, file: File, description?: string) => {
  const formData = new FormData();
  formData.append('file', file);
  if (description) {
    formData.append('description', description);
  }
  return api.post(`/locations/${locationId}/images`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

export const getLocationImages = (locationId: number) => api.get(`/locations/${locationId}/images`);
export const deleteImage = (imageType: string, imageId: number) => api.delete(`/images/${imageType}/${imageId}`);

export const uploadDroneImage = (droneId: number, file: File, description?: string) => {
  const formData = new FormData();
  formData.append('file', file);
  if (description) {
    formData.append('description', description);
  }
  return api.post(`/drones/${droneId}/images`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

export const getDroneImages = (droneId: number) => api.get(`/drones/${droneId}/images`);

export default api;
