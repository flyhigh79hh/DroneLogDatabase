import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { getBatteryPackById, updateBatteryPack } from '../services/api';
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
  Link,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TableSortLabel
} from '@mui/material';
import { IoArrowBack } from 'react-icons/io5';

// Interfaces & Types
interface BatteryPack { id: number; number: string; name: string; purchase_date?: string; notes?: string; cycles?: number; voltage_level?: string; capacity_mah?: number; flights?: Flight[]; }
interface Flight { id: number; flight_date: string; notes?: string; }
type Order = 'asc' | 'desc';

// Sorting Functions
function descendingComparator<T>(a: T, b: T, orderBy: keyof T) {
  const valA = a[orderBy] || '';
  const valB = b[orderBy] || '';
  if (valB < valA) return -1;
  if (valB > valA) return 1;
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

const BatteryPackDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const batteryPackId = parseInt(id || '');
  const [batteryPack, setBatteryPack] = useState<BatteryPack | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<BatteryPack>>({});
  const [order, setOrder] = useState<Order>('desc');
  const [orderBy, setOrderBy] = useState<keyof Flight>('flight_date');

  const fetchBatteryPack = useCallback(async () => {
    try {
      const response = await getBatteryPackById(batteryPackId);
      setBatteryPack(response.data);
      setEditData(response.data);
    } catch (error) {
      console.error('Error fetching battery pack:', error);
    }
  }, [batteryPackId]);

  useEffect(() => {
    if (batteryPackId) fetchBatteryPack();
  }, [batteryPackId, fetchBatteryPack]);

  const handleRequestSort = (property: keyof Flight) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const sortedFlights = useMemo(() => 
    stableSort(batteryPack?.flights || [], getComparator(order, orderBy)),
    [batteryPack?.flights, order, orderBy]
  );

  const handleUpdate = async () => {
    if (!batteryPack) return;
    try {
      await updateBatteryPack(
        batteryPack.id,
        editData.number || '',
        editData.name || '',
        editData.purchase_date || undefined,
        editData.notes || undefined,
        editData.voltage_level || undefined,
        editData.capacity_mah ? Number(editData.capacity_mah) : undefined
      );
      setIsEditing(false);
      fetchBatteryPack();
    } catch (error) {
      console.error('Error updating battery pack:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | { target: { name: string; value: unknown } }) => {
    const { name, value } = e.target;
    setEditData(prev => ({ ...prev, [name]: value }));
  };

  if (!batteryPack) {
    return <CircularProgress />;
  }

  const renderDetails = () => (
    <Box>
      <Typography variant="body1"><strong>Number:</strong> {batteryPack.number}</Typography>
      <Typography variant="body1"><strong>Purchase Date:</strong> {batteryPack.purchase_date ? new Date(batteryPack.purchase_date).toLocaleDateString() : 'N/A'}</Typography>
      <Typography variant="body1"><strong>Voltage:</strong> {batteryPack.voltage_level || 'N/A'}</Typography>
      <Typography variant="body1"><strong>Capacity:</strong> {batteryPack.capacity_mah ? `${batteryPack.capacity_mah} mAh` : 'N/A'}</Typography>
      <Typography variant="body1"><strong>Cycles:</strong> {batteryPack.cycles || 0}</Typography>
      <Typography variant="body1" sx={{ mt: 2, whiteSpace: 'pre-wrap' }}><strong>Notes:</strong> {batteryPack.notes || 'None'}</Typography>
      <Button onClick={() => setIsEditing(true)} variant="contained" sx={{ mt: 2 }}>Edit</Button>
    </Box>
  );

  const renderEditForm = () => (
    <Box>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}><TextField label="Number" name="number" value={editData.number || ''} onChange={handleInputChange} fullWidth /></Grid>
        <Grid item xs={12} sm={6}><TextField label="Name" name="name" value={editData.name || ''} onChange={handleInputChange} fullWidth /></Grid>
        <Grid item xs={12} sm={6}><TextField label="Purchase Date" name="purchase_date" type="date" value={editData.purchase_date || ''} onChange={handleInputChange} fullWidth InputLabelProps={{ shrink: true }} /></Grid>
        <Grid item xs={12} sm={6}><FormControl fullWidth><InputLabel>Voltage</InputLabel><Select name="voltage_level" label="Voltage" value={editData.voltage_level || ''} onChange={handleInputChange}>{['1S', '2S', '3S', '4S', '5S', '6S'].map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}</Select></FormControl></Grid>
        <Grid item xs={12} sm={6}><TextField label="Capacity (mAh)" name="capacity_mah" type="number" value={editData.capacity_mah || ''} onChange={handleInputChange} fullWidth /></Grid>
        <Grid item xs={12}><TextField label="Notes" name="notes" value={editData.notes || ''} onChange={handleInputChange} multiline rows={3} fullWidth /></Grid>
      </Grid>
      <Box sx={{ mt: 2 }}>
        <Button onClick={handleUpdate} variant="contained">Save</Button>
        <Button onClick={() => setIsEditing(false)} sx={{ ml: 1 }}>Cancel</Button>
      </Box>
    </Box>
  );

  return (
    <Box>
      <Button component={RouterLink} to="/batteries" startIcon={<IoArrowBack />} sx={{ mb: 2 }}>Back to Battery Packs</Button>
      <Typography variant="h4" gutterBottom>Battery Pack: {isEditing ? editData.name : batteryPack.name}</Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Details</Typography>
            {isEditing ? renderEditForm() : renderDetails()}
          </Paper>
        </Grid>
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Associated Flights ({batteryPack.flights?.length || 0})</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead><TableRow>
                  <TableCell sortDirection={orderBy === 'flight_date' ? order : false}><TableSortLabel active={orderBy === 'flight_date'} direction={order} onClick={() => handleRequestSort('flight_date')}>Date</TableSortLabel></TableCell>
                  <TableCell sortDirection={orderBy === 'notes' ? order : false}><TableSortLabel active={orderBy === 'notes'} direction={order} onClick={() => handleRequestSort('notes')}>Notes</TableSortLabel></TableCell>
                </TableRow></TableHead>
                <TableBody>
                  {sortedFlights.map(flight => (
                    <TableRow key={flight.id} hover>
                      <TableCell><Link component={RouterLink} to={`/flights/${flight.id}`}>{new Date(flight.flight_date).toLocaleDateString()}</Link></TableCell>
                      <TableCell>{flight.notes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default BatteryPackDetail;

