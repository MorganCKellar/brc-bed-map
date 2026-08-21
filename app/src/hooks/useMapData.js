import { useState, useEffect, useCallback } from 'react';
import { generateMockData, validateDistributions } from '../utils/mockData';
import { fetchCamps, testConnection, parseAddress } from '../utils/airtableClient';
import { loadStaticData, getDataSource } from '../utils/dataLoader';
import { logger } from '../utils/logger';

/**
 * Custom hook for managing BED Map data
 *
 * Data loading priority:
 * 1. Static snapshot (default, secure, no API calls)
 * 2. Airtable API (development/testing with ?source=airtable)
 * 3. Mock data (fallback for testing with ?source=mock)
 *
 * @param {string} [dataSource] - Optional data source override
 * @returns {Object} Hook return object
 * @returns {Array} returns.camps - Array of camp objects with BED status
 * @returns {boolean} returns.loading - Loading state
 * @returns {string|null} returns.error - Error message if any
 * @returns {Object|null} returns.dataMetadata - Metadata about data source
 * @returns {Function} returns.refresh - Function to refresh data
 */

export const useMapData = (dataSource = null) => {
  const [camps, setCamps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dataMetadata, setDataMetadata] = useState(null);

  // Determine data source from URL params if not explicitly provided
  const effectiveSource = dataSource || getDataSource();

  const loadFromStatic = useCallback(async () => {
    const startTime = performance.now();
    try {
      setLoading(true);
      setError(null);

      logger.data.info('Loading data from static snapshot');

      const { camps: staticCamps, metadata } = await loadStaticData();

      setCamps(staticCamps);
      setDataMetadata(metadata);
      setLoading(false);

      // Track performance
      const fetchTime = performance.now() - startTime;
      if (window.trackDataFetch) {
        window.trackDataFetch(fetchTime, 'static');
      }

      logger.data.info('Static data loaded successfully', {
        camps: staticCamps.length,
        metadata
      });

    } catch (err) {
      logger.error.error('Error loading static data, falling back to mock:', err);
      setError(`Failed to load static data: ${err.message}`);

      // Fall back to mock data
      await generateMockCamps();
    }
  }, []);

  const fetchAirtableData = useCallback(async () => {
    const startTime = performance.now();
    try {
      setLoading(true);
      setError(null);

      logger.data.info('Loading data from Airtable API');

      // Test connection first
      const connectionTest = await testConnection();
      if (!connectionTest.success) {
        logger.data.warn('Airtable connection failed, falling back to static data', {
          reason: connectionTest.message
        });

        // Fall back to static data
        await loadFromStatic();
        return;
      }

      // Fetch real data from Airtable
      const airtableCamps = await fetchCamps();

      // Validate and parse addresses
      const validCamps = airtableCamps.filter(camp => {
        // Skip camps with empty or invalid addresses
        if (!camp.placement_address || camp.placement_address.trim() === '') {
          logger.data.warn(`Empty address for camp: ${camp.camp_name}`);
          return false;
        }

        const parsed = parseAddress(camp.placement_address);
        if (!parsed) {
          logger.data.warn(`Invalid address format: "${camp.placement_address}" for camp: ${camp.camp_name}`);
          return false;
        }
        return true;
      });

      // Check for potential duplicate camp names
      const campNameCounts = {};
      validCamps.forEach(camp => {
        const name = camp.camp_name?.toLowerCase().trim();
        if (name) {
          campNameCounts[name] = (campNameCounts[name] || 0) + 1;
        }
      });

      const duplicates = Object.entries(campNameCounts).filter(([, count]) => count > 1);
      if (duplicates.length > 0) {
        logger.data.warn('Found potential duplicate camp names:', duplicates.map(([name, count]) => `"${name}" (${count}x)`));
      }

      // Calculate statistics
      const stats = validCamps.reduce((acc, camp) => {
        acc[camp.bed_status] = (acc[camp.bed_status] || 0) + 1;
        return acc;
      }, {});

      const metadata = {
        generatedAt: new Date().toISOString(),
        source: 'airtable',
        totalCamps: validCamps.length,
        stats
      };

      logger.data.info('Loaded camps from Airtable', {
        valid: validCamps.length,
        total: airtableCamps.length
      });

      setCamps(validCamps);
      setDataMetadata(metadata);
      setLoading(false);

      // Track performance
      const fetchTime = performance.now() - startTime;
      if (window.trackDataFetch) {
        window.trackDataFetch(fetchTime, 'airtable');
      }

    } catch (err) {
      logger.error.error('Error fetching Airtable data:', err);
      setError(`Failed to load Airtable data: ${err.message}`);

      // Fall back to static data
      logger.data.info('Falling back to static data');
      await loadFromStatic();

      // Track performance for fallback
      const fetchTime = performance.now() - startTime;
      if (window.trackDataFetch) {
        window.trackDataFetch(fetchTime, 'airtable-fallback');
      }
    }
  }, [loadFromStatic]);

  const generateMockCamps = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      logger.data.info('Generating mock data');

      const mockCamps = generateMockData();
      const validation = validateDistributions(mockCamps);

      // Calculate statistics
      const stats = mockCamps.reduce((acc, camp) => {
        acc[camp.bed_status] = (acc[camp.bed_status] || 0) + 1;
        return acc;
      }, {});

      const metadata = {
        generatedAt: new Date().toISOString(),
        source: 'mock',
        totalCamps: mockCamps.length,
        stats,
        validation
      };

      logger.data.debug('Mock data validation:', validation);

      setCamps(mockCamps);
      setDataMetadata(metadata);
      setLoading(false);

      logger.data.info('Mock data generated successfully', {
        camps: mockCamps.length,
        stats
      });

    } catch (err) {
      logger.error.error('Error generating mock data:', err);
      setError('Failed to generate mock data');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    switch (effectiveSource) {
      case 'mock':
        generateMockCamps();
        break;

      case 'airtable':
        fetchAirtableData();
        break;

      case 'static':
      default:
        loadFromStatic();
        break;
    }
  }, [effectiveSource, generateMockCamps, fetchAirtableData, loadFromStatic]);

  const refresh = useCallback(() => {
    switch (effectiveSource) {
      case 'mock':
        generateMockCamps();
        break;

      case 'airtable':
        fetchAirtableData();
        break;

      case 'static':
      default:
        loadFromStatic();
        break;
    }
  }, [effectiveSource, generateMockCamps, fetchAirtableData, loadFromStatic]);

  return {
    camps,
    loading,
    error,
    dataMetadata,
    dataSource: effectiveSource,
    refresh
  };
};
