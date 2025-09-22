import React, { useState, useEffect, useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { getBatteryPacks, createBatteryPack, deleteBatteryPack } from '../services/api';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  TableSortLabel
} from '@mui/material';
import { MdDelete, MdInfo } from 'react-icons/md';

// Interfaces & Types
interface BatteryPack { id: number; number: string; name: string; }
type Order = 'asc' | 'desc';

// Sorting Functions
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

const BatteryPacks: React.FC = () => {
  const [batteryPacks, setBatteryPacks] = useState<BatteryPack[]>([]);
  const [newPackNumber, setNewPackNumber] = useState('');
  const [newPackName, setNewPackName] = useState('');
  const [order, setOrder] = useState<Order>('asc');
  const [orderBy, setOrderBy] = useState<keyof BatteryPack>('number');

  useEffect(() => {
    fetchBatteryPacks();
  }, []);

  const fetchBatteryPacks = async () => {
    try {
      const response = await getBatteryPacks();
      setBatteryPacks(response.data);
    } catch (error) {
      console.error('Error fetching battery packs:', error);
    }
  };

  const handleRequestSort = (property: keyof BatteryPack) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const sortedBatteryPacks = useMemo(() => 
    stableSort(batteryPacks, getComparator(order, orderBy)), 
    [batteryPacks, order, orderBy]
  );

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPackNumber && newPackName) {
      try {
        await createBatteryPack(newPackNumber, newPackName);
        setNewPackNumber('');
        setNewPackName('');
        fetchBatteryPacks();
      } catch (error) {
        console.error('Error creating battery pack:', error);
      }
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteBatteryPack(id);
      fetchBatteryPacks();
    } catch (error) {
      console.error('Error deleting battery pack:', error);
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
      <Paper sx={{ p: 2, flex: 1 }}>
        <Typography variant="h5" component="h2" gutterBottom>Add New Pack</Typography>
        <Box component="form" onSubmit={handleCreate} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField label="Pack Number" variant="outlined" value={newPackNumber} onChange={(e) => setNewPackNumber(e.target.value)} required />
          <TextField label="Pack Name" variant="outlined" value={newPackName} onChange={(e) => setNewPackName(e.target.value)} required />
          <Button type="submit" variant="contained" sx={{ alignSelf: 'flex-start' }}>Add Pack</Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 2, flex: 2 }}>
        <Typography variant="h5" component="h2" gutterBottom>Existing Battery Packs</Typography>
        <TableContainer>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sortDirection={orderBy === 'number' ? order : false}>
                  <TableSortLabel active={orderBy === 'number'} direction={orderBy === 'number' ? order : 'asc'} onClick={() => handleRequestSort('number')}>Number</TableSortLabel>
                </TableCell>
                <TableCell sortDirection={orderBy === 'name' ? order : false}>
                  <TableSortLabel active={orderBy === 'name'} direction={orderBy === 'name' ? order : 'asc'} onClick={() => handleRequestSort('name')}>Name</TableSortLabel>
                </TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedBatteryPacks.map((pack) => (
                <TableRow key={pack.id} hover>
                  <TableCell>{pack.number}</TableCell>
                  <TableCell>{pack.name}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Details"><IconButton component={RouterLink} to={`/batteries/${pack.id}`} size="small"><MdInfo /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton onClick={() => handleDelete(pack.id)} size="small"><MdDelete /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};

export default BatteryPacks;
